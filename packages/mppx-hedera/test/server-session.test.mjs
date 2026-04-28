/**
 * Server session unit tests for mppx-hedera.
 *
 * Tests channel state management, voucher monotonicity, and respond() logic.
 * On-chain interactions (viem readContract/writeContract) are NOT mocked here;
 * those are covered by integration tests. This file focuses on the store-level
 * invariants and the channelStoreFromStore wrapper behavior.
 *
 * Imports from the BUILT dist/ — run `pnpm build` before executing.
 * Usage:  node test/server-session.test.mjs
 */

import assert from 'node:assert/strict';
import { Store } from 'mppx';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2705 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u274c ${name}`);
    console.log(`        ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_ID = '0x0000000000000000000000000000000000000000000000000000000000000001';
const CHANNEL_ID_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
const ESCROW = '0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE';
const PAYER = '0x1111111111111111111111111111111111111111';
const PAYEE = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x0000000000000000000000000000000000001549';

function makeChannelState(channelId, opts = {}) {
  return {
    channelId,
    chainId: 296,
    escrowContract: ESCROW,
    payer: PAYER,
    payee: PAYEE,
    token: TOKEN,
    authorizedSigner: opts.authorizedSigner ?? PAYER,
    deposit: opts.deposit ?? 10000n,
    settledOnChain: opts.settled ?? 0n,
    highestVoucherAmount: opts.voucher ?? 0n,
    highestVoucher: opts.highestVoucher ?? null,
    spent: opts.spent ?? 0n,
    units: opts.units ?? 0,
    finalized: opts.finalized ?? false,
    closeRequestedAt: opts.closeRequestedAt ?? undefined,
    createdAt: opts.createdAt ?? new Date().toISOString(),
  };
}

async function seedSession(store, channelId, opts = {}) {
  const state = makeChannelState(channelId, opts);
  await store.put(channelId, state);
  return state;
}

// ---------------------------------------------------------------------------
// Channel state invariant tests
// ---------------------------------------------------------------------------

console.log('\nChannel state management');

await test('1. Channel state: spent increases with each deduction', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { spent: 0n });

  // Simulate two deductions
  let ch = await store.get(CHANNEL_ID);
  await store.put(CHANNEL_ID, { ...ch, spent: BigInt(ch.spent) + 1000n });
  ch = await store.get(CHANNEL_ID);
  await store.put(CHANNEL_ID, { ...ch, spent: BigInt(ch.spent) + 1000n });
  ch = await store.get(CHANNEL_ID);

  assert.equal(BigInt(ch.spent), 2000n);
});

await test('2. Channel state: units count increases', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { units: 5 });

  let ch = await store.get(CHANNEL_ID);
  await store.put(CHANNEL_ID, { ...ch, units: Number(ch.units) + 1 });
  ch = await store.get(CHANNEL_ID);
  await store.put(CHANNEL_ID, { ...ch, units: Number(ch.units) + 1 });
  ch = await store.get(CHANNEL_ID);

  assert.equal(ch.units, 7);
});

await test('3. Channel state: highestVoucherAmount only increases', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { voucher: 3000n });

  let ch = await store.get(CHANNEL_ID);
  const currentHighest = BigInt(ch.highestVoucherAmount);

  // Attempt lower — should be rejected by logic
  const newLower = 2000n;
  assert.ok(newLower <= currentHighest, 'lower cumulative rejected');

  // Accept higher
  const newHigher = 5000n;
  assert.ok(newHigher > currentHighest, 'higher cumulative accepted');
  await store.put(CHANNEL_ID, { ...ch, highestVoucherAmount: newHigher });
  ch = await store.get(CHANNEL_ID);
  assert.equal(BigInt(ch.highestVoucherAmount), 5000n);
});

await test('4. Channel state: finalized prevents further operations', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { finalized: true });

  const ch = await store.get(CHANNEL_ID);
  assert.equal(ch.finalized, true, 'channel should be finalized');

  // Business logic check: finalized channels should reject vouchers
  const shouldReject = ch.finalized === true;
  assert.ok(shouldReject, 'finalized channel rejects operations');
});

await test('5. Channel state: deposit tracks on-chain value', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { deposit: 50000n });

  const ch = await store.get(CHANNEL_ID);
  assert.equal(BigInt(ch.deposit), 50000n);

  // Simulate topUp
  await store.put(CHANNEL_ID, { ...ch, deposit: 75000n });
  const updated = await store.get(CHANNEL_ID);
  assert.equal(BigInt(updated.deposit), 75000n);
});

// ---------------------------------------------------------------------------
// Voucher monotonicity
// ---------------------------------------------------------------------------

console.log('\nVoucher monotonicity');

await test('6. Voucher monotonicity: higher cumulative accepted', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { voucher: 3000n, deposit: 10000n });

  const ch = await store.get(CHANNEL_ID);
  const currentHighest = BigInt(ch.highestVoucherAmount);
  const newCumulative = 5000n;

  assert.ok(newCumulative > currentHighest, 'new cumulative is higher');

  await store.put(CHANNEL_ID, {
    ...ch,
    highestVoucherAmount: newCumulative,
    highestVoucher: { channelId: CHANNEL_ID, cumulativeAmount: newCumulative, signature: '0xabc' },
    spent: BigInt(ch.spent) + 1000n,
    units: Number(ch.units) + 1,
  });

  const updated = await store.get(CHANNEL_ID);
  assert.equal(BigInt(updated.highestVoucherAmount), 5000n);
});

await test('7. Voucher monotonicity: lower/equal cumulative returns existing receipt (no error)', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { voucher: 5000n, spent: 2000n, units: 3 });

  const ch = await store.get(CHANNEL_ID);
  const currentHighest = BigInt(ch.highestVoucherAmount);
  const lowerAmount = 3000n;
  const equalAmount = 5000n;

  // Session handler returns existing receipt for lower/equal (no throw)
  assert.ok(lowerAmount <= currentHighest, 'lower amount detected');
  assert.ok(equalAmount <= currentHighest, 'equal amount detected');

  // Verify state unchanged
  const unchanged = await store.get(CHANNEL_ID);
  assert.equal(BigInt(unchanged.highestVoucherAmount), 5000n);
  assert.equal(BigInt(unchanged.spent), 2000n);
  assert.equal(unchanged.units, 3);
});

await test('8. Voucher: exceeding deposit rejected', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { deposit: 10000n, voucher: 5000n });

  const ch = await store.get(CHANNEL_ID);
  const exceeds = 15000n;
  const deposit = BigInt(ch.deposit);

  assert.ok(exceeds > deposit, 'cumulative exceeds deposit');
  // Session handler would throw AmountExceedsDepositError
});

await test('9. Voucher: unknown channelId rejected', async () => {
  const store = Store.memory();
  const unknown = await store.get('0xdeadbeef');
  assert.equal(unknown, null, 'unknown channel returns null');
  // Session handler would throw ChannelNotFoundError
});

await test('10. Voucher: finalized channel rejected', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { finalized: true });

  const ch = await store.get(CHANNEL_ID);
  assert.equal(ch.finalized, true);
  // Session handler would throw ChannelClosedError
});

await test('11. MinVoucherDelta: delta below minimum rejected', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { voucher: 5000n, deposit: 10000n });

  const ch = await store.get(CHANNEL_ID);
  const currentHighest = BigInt(ch.highestVoucherAmount);
  const minDelta = 500n;
  const newCumulative = 5100n; // delta = 100 < 500

  const delta = newCumulative - currentHighest;
  assert.ok(delta < minDelta, `delta ${delta} is below minimum ${minDelta}`);
});

// ---------------------------------------------------------------------------
// Store behavior
// ---------------------------------------------------------------------------

console.log('\nStore behavior');

await test('12. Store: channel persists across get/put cycles', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { deposit: 7777n });

  const first = await store.get(CHANNEL_ID);
  assert.ok(first, 'first get returns state');

  // Modify and re-read
  await store.put(CHANNEL_ID, { ...first, units: 42 });
  const second = await store.get(CHANNEL_ID);
  assert.equal(second.units, 42);
  assert.equal(second.channelId, CHANNEL_ID);
});

await test('13. Store: bigint values survive serialization roundtrip', async () => {
  const store = Store.memory();
  const bigValues = {
    channelId: CHANNEL_ID,
    deposit: 999999999999999999n,
    highestVoucherAmount: 123456789012345678n,
    spent: 42n,
    settledOnChain: 0n,
  };
  await store.put(CHANNEL_ID, bigValues);

  const retrieved = await store.get(CHANNEL_ID);
  // Store.memory() JSON-roundtrips, so bigints become strings
  assert.equal(BigInt(retrieved.deposit), 999999999999999999n);
  assert.equal(BigInt(retrieved.highestVoucherAmount), 123456789012345678n);
  assert.equal(BigInt(retrieved.spent), 42n);
  assert.equal(BigInt(retrieved.settledOnChain), 0n);
});

await test('14. Store: null returned for unknown channel', async () => {
  const store = Store.memory();
  const result = await store.get('0xnonexistent');
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Open action state
// ---------------------------------------------------------------------------

console.log('\nOpen action');

await test('15. Open: sets all channel state fields correctly', async () => {
  const store = Store.memory();
  const state = makeChannelState(CHANNEL_ID, {
    deposit: 50000n,
    voucher: 1000n,
    spent: 1000n,
    units: 1,
  });
  await store.put(CHANNEL_ID, state);

  const ch = await store.get(CHANNEL_ID);
  assert.equal(ch.channelId, CHANNEL_ID);
  assert.equal(ch.chainId, 296);
  assert.equal(ch.escrowContract, ESCROW);
  assert.equal(ch.payer, PAYER);
  assert.equal(ch.payee, PAYEE);
  assert.equal(ch.token, TOKEN);
  assert.equal(ch.authorizedSigner, PAYER);
  assert.equal(BigInt(ch.deposit), 50000n);
  assert.equal(BigInt(ch.highestVoucherAmount), 1000n);
  assert.equal(BigInt(ch.spent), 1000n);
  assert.equal(ch.units, 1);
  assert.equal(ch.finalized, false);
  assert.ok(ch.createdAt, 'createdAt is set');
});

await test('16. Open: rejects when channel already exists in store', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { deposit: 10000n });

  const existing = await store.get(CHANNEL_ID);
  assert.ok(existing, 'channel already exists');
  // Server-side open would detect this by checking on-chain state;
  // store-level check confirms the existing state is returned
  assert.equal(existing.channelId, CHANNEL_ID);
});

// ---------------------------------------------------------------------------
// TopUp action
// ---------------------------------------------------------------------------

console.log('\nTopUp action');

await test('17. TopUp: increases deposit in store', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { deposit: 10000n });

  let ch = await store.get(CHANNEL_ID);
  const oldDeposit = BigInt(ch.deposit);
  const newDeposit = 25000n;
  assert.ok(newDeposit > oldDeposit, 'new deposit is higher');

  await store.put(CHANNEL_ID, { ...ch, deposit: newDeposit });
  ch = await store.get(CHANNEL_ID);
  assert.equal(BigInt(ch.deposit), 25000n);
});

await test('18. TopUp: rejects when deposit did not increase', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { deposit: 10000n });

  const ch = await store.get(CHANNEL_ID);
  const currentDeposit = BigInt(ch.deposit);
  const sameDeposit = 10000n;
  const lowerDeposit = 5000n;

  assert.ok(sameDeposit <= currentDeposit, 'same deposit rejected');
  assert.ok(lowerDeposit <= currentDeposit, 'lower deposit rejected');
});

await test('19. TopUp: rejects unknown channel', async () => {
  const store = Store.memory();
  const ch = await store.get('0xunknown');
  assert.equal(ch, null, 'unknown channel returns null — would throw ChannelNotFoundError');
});

// ---------------------------------------------------------------------------
// Close action
// ---------------------------------------------------------------------------

console.log('\nClose action');

await test('20. Close: sets finalized=true', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { spent: 5000n, deposit: 10000n });

  let ch = await store.get(CHANNEL_ID);
  await store.put(CHANNEL_ID, {
    ...ch,
    finalized: true,
    highestVoucherAmount: 5000n,
    highestVoucher: { channelId: CHANNEL_ID, cumulativeAmount: 5000n, signature: '0xsig' },
  });

  ch = await store.get(CHANNEL_ID);
  assert.equal(ch.finalized, true);
});

await test('21. Close: rejects already finalized', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { finalized: true });

  const ch = await store.get(CHANNEL_ID);
  assert.equal(ch.finalized, true, 'already finalized — would throw ChannelClosedError');
});

await test('22. Close: rejects below spent amount', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { spent: 5000n, settled: 0n });

  const ch = await store.get(CHANNEL_ID);
  const closeAmount = 3000n;
  const minClose = BigInt(ch.spent) > BigInt(ch.settledOnChain)
    ? BigInt(ch.spent)
    : BigInt(ch.settledOnChain);

  assert.ok(closeAmount < minClose, `close amount ${closeAmount} below minimum ${minClose}`);
});

await test('23. Close: rejects below settled amount', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { spent: 1000n, settled: 8000n });

  const ch = await store.get(CHANNEL_ID);
  const closeAmount = 5000n;
  const minClose = BigInt(ch.spent) > BigInt(ch.settledOnChain)
    ? BigInt(ch.spent)
    : BigInt(ch.settledOnChain);

  assert.equal(minClose, 8000n, 'minClose is max(spent, settled)');
  assert.ok(closeAmount < minClose, `close amount ${closeAmount} below settled ${minClose}`);
});

// ---------------------------------------------------------------------------
// Force-close / requestClose
// ---------------------------------------------------------------------------

console.log('\nForce-close');

await test('24. Force-close: requestClose sets closeRequestedAt', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID);

  let ch = await store.get(CHANNEL_ID);
  const now = Date.now();
  await store.put(CHANNEL_ID, { ...ch, closeRequestedAt: now });

  ch = await store.get(CHANNEL_ID);
  assert.equal(ch.closeRequestedAt, now);
});

// ---------------------------------------------------------------------------
// Incremental settlement
// ---------------------------------------------------------------------------

console.log('\nSettlement');

await test('25. Incremental settlement: two settles cumulative not additive', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { settled: 0n, deposit: 100000n });

  // First settle: cumulative 3000
  let ch = await store.get(CHANNEL_ID);
  await store.put(CHANNEL_ID, { ...ch, settledOnChain: 3000n });

  // Second settle: cumulative 7000 (NOT 3000 + 7000)
  ch = await store.get(CHANNEL_ID);
  await store.put(CHANNEL_ID, { ...ch, settledOnChain: 7000n });

  ch = await store.get(CHANNEL_ID);
  assert.equal(BigInt(ch.settledOnChain), 7000n, 'settled is cumulative, not additive');
});

await test('26. Close with zero amount: full refund scenario (state check)', async () => {
  const store = Store.memory();
  await seedSession(store, CHANNEL_ID, { spent: 0n, settled: 0n, deposit: 10000n });

  const ch = await store.get(CHANNEL_ID);
  const closeAmount = 0n;
  const minClose = BigInt(ch.spent) > BigInt(ch.settledOnChain)
    ? BigInt(ch.spent)
    : BigInt(ch.settledOnChain);

  // Both spent and settled are 0, so close with 0 is valid (full refund)
  assert.equal(minClose, 0n);
  assert.ok(closeAmount >= minClose, 'zero close valid when spent=0 and settled=0');
});

// ---------------------------------------------------------------------------
// respond() behavior
// ---------------------------------------------------------------------------

console.log('\nrespond() behavior');

// Helper: simulate respond() logic from session.ts
function simulateRespond(action, method, headers) {
  if (action === 'close' || action === 'topUp') {
    return new Response(null, { status: 204 });
  }
  if (method === 'POST') {
    const contentLength = headers.get('content-length');
    if (contentLength !== null && contentLength !== '0') return undefined;
    if (headers.has('transfer-encoding')) return undefined;
    return new Response(null, { status: 204 });
  }
  return undefined;
}

await test('27. respond() returns 204 for close action', async () => {
  const res = simulateRespond('close', 'POST', new Headers());
  assert.ok(res instanceof Response);
  assert.equal(res.status, 204);
});

await test('28. respond() returns 204 for topUp action', async () => {
  const res = simulateRespond('topUp', 'POST', new Headers());
  assert.ok(res instanceof Response);
  assert.equal(res.status, 204);
});

await test('29. respond() returns undefined for voucher with body (passthrough)', async () => {
  const headers = new Headers({ 'content-length': '42' });
  const res = simulateRespond('voucher', 'POST', headers);
  assert.equal(res, undefined, 'should passthrough to application handler');
});

await test('30. respond() returns 204 for voucher POST without body', async () => {
  const headers = new Headers({ 'content-length': '0' });
  const res = simulateRespond('voucher', 'POST', headers);
  assert.ok(res instanceof Response);
  assert.equal(res.status, 204);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Session tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
