/**
 * server-charge.test.mjs — comprehensive tests for mppx-hedera server charge verification
 *
 * Tests the push-mode verify() path which queries Mirror Node to verify
 * Hedera native token transfers with challenge-bound Attribution memos.
 *
 * Mocks globalThis.fetch to avoid network calls.
 */

import { hedera } from '../dist/server/index.js';
import { Attribution } from '../dist/index.js';
import { Store } from 'mppx';

// ─── Constants ───────────────────────────────────────────────────────

const SERVER_ID = 'test-server';
const RECIPIENT = '0.0.99999';
const CHALLENGE_ID = 'test-challenge-123';
const TX_ID = '0.0.12345@1234567890.123456789';
const TOKEN_ID = '0.0.5449'; // testnet USDC

// ─── Helpers ─────────────────────────────────────────────────────────

function validMemo() {
  return Attribution.encode({ challengeId: CHALLENGE_ID, serverId: SERVER_ID });
}

function validCredential(overrides = {}) {
  return {
    challenge: {
      id: CHALLENGE_ID,
      realm: SERVER_ID,
      request: {
        amount: '10000',
        chainId: 296,
        recipient: RECIPIENT,
        currency: TOKEN_ID,
        ...(overrides.request || {}),
      },
      ...(overrides.challenge || {}),
    },
    payload: {
      type: 'hash',
      transactionId: TX_ID,
      ...(overrides.payload || {}),
    },
  };
}

function mockMirrorResponse({ result = 'SUCCESS', memo, tokenTransfers = [] }) {
  const memo_base64 = memo ? Buffer.from(memo).toString('base64') : '';
  return {
    ok: true,
    status: 200,
    json: async () => ({
      transactions: [{
        result,
        memo_base64,
        token_transfers: tokenTransfers,
      }],
    }),
  };
}

function defaultTokenTransfers(amount = 10000) {
  return [
    { token_id: TOKEN_ID, account: RECIPIENT, amount },
    { token_id: TOKEN_ID, account: '0.0.12345', amount: -amount },
  ];
}

function createHandler(storeOverride) {
  const store = storeOverride || Store.memory();
  const handler = hedera.charge({
    serverId: SERVER_ID,
    recipient: RECIPIENT,
    testnet: true,
    store,
    maxRetries: 1,
    retryDelay: 10, // fast retries for tests
  });
  return { handler, store };
}

// ─── Test runner ─────────────────────────────────────────────────────

const results = [];
let passed = 0;
let failed = 0;
const originalFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

async function test(name, fn) {
  // Always restore fetch before each test
  globalThis.fetch = originalFetch;
  try {
    await fn();
    passed++;
    results.push({ name, ok: true });
    console.log(`  \u2705 ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, ok: false, error: err.message || String(err) });
    console.log(`  \u274C ${name}`);
    console.log(`     ${err.message || err}`);
  } finally {
    // Always restore after
    globalThis.fetch = originalFetch;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertIncludes(str, substr, message) {
  if (!String(str).toLowerCase().includes(substr.toLowerCase())) {
    throw new Error(`${message}\n  Expected "${str}" to include "${substr}"`);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

console.log('\n=== Push mode verification ===\n');

await test('1. Accepts valid transaction with correct memo + transfers', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: defaultTokenTransfers(),
  });
  const credential = validCredential();
  const receipt = await handler.verify({ credential });
  assert(receipt, 'Expected a receipt');
});

await test('2. Rejects transaction with non-SUCCESS result', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    result: 'INSUFFICIENT_ACCOUNT_BALANCE',
    memo,
    tokenTransfers: defaultTokenTransfers(),
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.constructor.name !== 'Error' || err.message !== 'Should have thrown',
      'Expected verification error, not passthrough');
  }
});

await test('3. Rejects transaction with invalid MPP memo (random hex)', async () => {
  const { handler } = createHandler();
  globalThis.fetch = async () => mockMirrorResponse({
    memo: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    tokenTransfers: defaultTokenTransfers(),
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected verification error');
  }
});

await test('4. Rejects transaction with wrong server fingerprint', async () => {
  const { handler } = createHandler();
  const wrongMemo = Attribution.encode({ challengeId: CHALLENGE_ID, serverId: 'wrong-server' });
  globalThis.fetch = async () => mockMirrorResponse({
    memo: wrongMemo,
    tokenTransfers: defaultTokenTransfers(),
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected fingerprint mismatch error');
  }
});

await test('5. Rejects transaction with wrong challenge nonce', async () => {
  const { handler } = createHandler();
  const wrongMemo = Attribution.encode({ challengeId: 'wrong-challenge', serverId: SERVER_ID });
  globalThis.fetch = async () => mockMirrorResponse({
    memo: wrongMemo,
    tokenTransfers: defaultTokenTransfers(),
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected nonce mismatch error');
  }
});

await test('6. Rejects transaction with wrong recipient in token_transfers', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [
      { token_id: TOKEN_ID, account: '0.0.77777', amount: 10000 },
      { token_id: TOKEN_ID, account: '0.0.12345', amount: -10000 },
    ],
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected wrong recipient error');
  }
});

await test('7. Rejects transaction with wrong token_id in token_transfers', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [
      { token_id: '0.0.9999', account: RECIPIENT, amount: 10000 },
      { token_id: '0.0.9999', account: '0.0.12345', amount: -10000 },
    ],
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected wrong token error');
  }
});

await test('8. Rejects transaction with insufficient amount', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [
      { token_id: TOKEN_ID, account: RECIPIENT, amount: 5000 }, // less than 10000
      { token_id: TOKEN_ID, account: '0.0.12345', amount: -5000 },
    ],
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected insufficient amount error');
  }
});

await test('9. Rejects transaction with empty token_transfers', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [],
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected empty transfers error');
  }
});

await test('10. Rejects transaction with empty/missing memo_base64', async () => {
  const { handler } = createHandler();
  globalThis.fetch = async () => mockMirrorResponse({
    memo: '',
    tokenTransfers: defaultTokenTransfers(),
  });
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected missing memo error');
  }
});

console.log('\n=== Replay protection ===\n');

await test('11. Rejects replayed transaction ID (call verify twice with same txId)', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: defaultTokenTransfers(),
  });

  // First call succeeds
  await handler.verify({ credential: validCredential() });

  // Second call with same txId should fail
  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected replay rejection');
  }
});

await test('12. Accepts different transaction IDs for same challenge', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: defaultTokenTransfers(),
  });

  // First tx
  const cred1 = validCredential();
  await handler.verify({ credential: cred1 });

  // Different tx id, same challenge
  const cred2 = validCredential({
    payload: { type: 'hash', transactionId: '0.0.12345@9999999999.111111111' },
  });
  const receipt2 = await handler.verify({ credential: cred2 });
  assert(receipt2, 'Expected second verify to succeed');
});

await test('13. Store key format is hedera:charge:{transactionId}', async () => {
  const store = Store.memory();
  const { handler } = createHandler(store);
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: defaultTokenTransfers(),
  });

  await handler.verify({ credential: validCredential() });

  const stored = await store.get(`hedera:charge:${TX_ID}`);
  assert(stored !== null, `Expected store key "hedera:charge:${TX_ID}" to be set, got null`);
});

console.log('\n=== Splits verification ===\n');

await test('14. Accepts transaction with correct primary + split transfers', async () => {
  const { handler } = createHandler();
  const memo = validMemo();

  const splits = [
    { recipient: '0.0.88888', amount: '2000' },
    { recipient: '0.0.77777', amount: '1000' },
  ];

  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [
      { token_id: TOKEN_ID, account: RECIPIENT, amount: 7000 },  // 10000 - 2000 - 1000
      { token_id: TOKEN_ID, account: '0.0.88888', amount: 2000 },
      { token_id: TOKEN_ID, account: '0.0.77777', amount: 1000 },
      { token_id: TOKEN_ID, account: '0.0.12345', amount: -10000 },
    ],
  });

  const credential = validCredential({ request: { splits } });
  const receipt = await handler.verify({ credential });
  assert(receipt, 'Expected receipt with splits');
});

await test('15. Rejects when primary recipient amount is wrong (with splits)', async () => {
  const { handler } = createHandler();
  const memo = validMemo();

  const splits = [
    { recipient: '0.0.88888', amount: '2000' },
  ];

  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [
      { token_id: TOKEN_ID, account: RECIPIENT, amount: 5000 },  // should be 8000 (10000-2000)
      { token_id: TOKEN_ID, account: '0.0.88888', amount: 2000 },
      { token_id: TOKEN_ID, account: '0.0.12345', amount: -7000 },
    ],
  });

  try {
    const credential = validCredential({ request: { splits } });
    await handler.verify({ credential });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected primary amount mismatch');
  }
});

await test('16. Rejects when split recipient is missing from token_transfers', async () => {
  const { handler } = createHandler();
  const memo = validMemo();

  const splits = [
    { recipient: '0.0.88888', amount: '2000' },
    { recipient: '0.0.77777', amount: '1000' },
  ];

  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [
      { token_id: TOKEN_ID, account: RECIPIENT, amount: 7000 },
      { token_id: TOKEN_ID, account: '0.0.88888', amount: 2000 },
      // Missing 0.0.77777
      { token_id: TOKEN_ID, account: '0.0.12345', amount: -9000 },
    ],
  });

  try {
    const credential = validCredential({ request: { splits } });
    await handler.verify({ credential });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected missing split recipient error');
  }
});

await test('17. Rejects when split amount is insufficient', async () => {
  const { handler } = createHandler();
  const memo = validMemo();

  const splits = [
    { recipient: '0.0.88888', amount: '2000' },
  ];

  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [
      { token_id: TOKEN_ID, account: RECIPIENT, amount: 8000 },
      { token_id: TOKEN_ID, account: '0.0.88888', amount: 500 }, // insufficient, expected 2000
      { token_id: TOKEN_ID, account: '0.0.12345', amount: -8500 },
    ],
  });

  try {
    const credential = validCredential({ request: { splits } });
    await handler.verify({ credential });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected insufficient split amount error');
  }
});

console.log('\n=== request() hook ===\n');

await test('18. Fills in default chainId from testnet config', async () => {
  const { handler } = createHandler();
  const result = handler.request({ request: { amount: '1000' } });
  assert(result.chainId === 296, `Expected chainId 296, got ${result.chainId}`);
});

await test('19. Fills in default recipient from config', async () => {
  const { handler } = createHandler();
  const result = handler.request({ request: { amount: '1000' } });
  assert(result.recipient === RECIPIENT, `Expected recipient ${RECIPIENT}, got ${result.recipient}`);
});

await test('20. Fills in default currency from config', async () => {
  const { handler } = createHandler();
  const result = handler.request({ request: { amount: '1000' } });
  assert(result.currency === TOKEN_ID, `Expected currency ${TOKEN_ID}, got ${result.currency}`);
});

await test('21. Preserves explicit chainId from request', async () => {
  const { handler } = createHandler();
  const result = handler.request({ request: { amount: '1000', chainId: 295 } });
  assert(result.chainId === 295, `Expected chainId 295, got ${result.chainId}`);
});

await test('22. Preserves explicit recipient from request', async () => {
  const { handler } = createHandler();
  const result = handler.request({ request: { amount: '1000', recipient: '0.0.11111' } });
  assert(result.recipient === '0.0.11111', `Expected recipient 0.0.11111, got ${result.recipient}`);
});

console.log('\n=== Error types ===\n');

await test('23. Throws error with reason containing "already used" on replay', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: defaultTokenTransfers(),
  });

  await handler.verify({ credential: validCredential() });

  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assertIncludes(err.reason || err.message, 'already used', 'Expected "already used" in error');
  }
});

await test('24. Throws error with reason containing "memo" on bad memo', async () => {
  const { handler } = createHandler();
  globalThis.fetch = async () => mockMirrorResponse({
    memo: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    tokenTransfers: defaultTokenTransfers(),
  });

  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assertIncludes(err.reason || err.message, 'memo', 'Expected "memo" in error');
  }
});

await test('25. Throws error with reason containing "fingerprint" on wrong server', async () => {
  const { handler } = createHandler();
  const wrongMemo = Attribution.encode({ challengeId: CHALLENGE_ID, serverId: 'wrong-server' });
  globalThis.fetch = async () => mockMirrorResponse({
    memo: wrongMemo,
    tokenTransfers: defaultTokenTransfers(),
  });

  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assertIncludes(err.reason || err.message, 'fingerprint', 'Expected "fingerprint" in error');
  }
});

await test('26. Throws error with reason containing "nonce" on wrong challenge', async () => {
  const { handler } = createHandler();
  const wrongMemo = Attribution.encode({ challengeId: 'wrong-challenge', serverId: SERVER_ID });
  globalThis.fetch = async () => mockMirrorResponse({
    memo: wrongMemo,
    tokenTransfers: defaultTokenTransfers(),
  });

  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assertIncludes(err.reason || err.message, 'nonce', 'Expected "nonce" in error');
  }
});

await test('27. Throws error with reason containing "token transfer" on wrong recipient', async () => {
  const { handler } = createHandler();
  const memo = validMemo();
  globalThis.fetch = async () => mockMirrorResponse({
    memo,
    tokenTransfers: [
      { token_id: TOKEN_ID, account: '0.0.77777', amount: 10000 },
    ],
  });

  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assertIncludes(err.reason || err.message, 'token transfer', 'Expected "token transfer" in error');
  }
});

console.log('\n=== Mirror Node retry ===\n');

await test('28. Retries on 404 then succeeds', async () => {
  // Use maxRetries=2 to allow retries
  const store = Store.memory();
  const handler = hedera.charge({
    serverId: SERVER_ID,
    recipient: RECIPIENT,
    testnet: true,
    store,
    maxRetries: 3,
    retryDelay: 10,
  });

  const memo = validMemo();
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return mockMirrorResponse({
      memo,
      tokenTransfers: defaultTokenTransfers(),
    });
  };

  const receipt = await handler.verify({ credential: validCredential() });
  assert(receipt, 'Expected receipt after retry');
  assert(callCount === 2, `Expected 2 fetch calls, got ${callCount}`);
});

await test('29. Fails after maxRetries exceeded', async () => {
  const store = Store.memory();
  const handler = hedera.charge({
    serverId: SERVER_ID,
    recipient: RECIPIENT,
    testnet: true,
    store,
    maxRetries: 2,
    retryDelay: 10,
  });

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected Mirror Node error after retries');
    // maxRetries=2 means attempts 0,1,2 = 3 calls total, but last one throws
    assert(callCount >= 2, `Expected at least 2 fetch calls, got ${callCount}`);
  }
});

await test('30. Handles Mirror Node returning no transactions array', async () => {
  const store = Store.memory();
  const handler = hedera.charge({
    serverId: SERVER_ID,
    recipient: RECIPIENT,
    testnet: true,
    store,
    maxRetries: 1,
    retryDelay: 10,
  });

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}), // no transactions array
  });

  try {
    await handler.verify({ credential: validCredential() });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message !== 'Should have thrown', 'Expected error for missing transactions');
  }
});

// ─── Summary ─────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`\n  Total: ${passed + failed}  |  Passed: ${passed}  |  Failed: ${failed}\n`);

if (failed > 0) {
  console.log('  Failed tests:');
  for (const r of results) {
    if (!r.ok) console.log(`    - ${r.name}: ${r.error}`);
  }
  console.log('');
}

// Ensure fetch is restored
globalThis.fetch = originalFetch;

process.exit(failed > 0 ? 1 : 0);
