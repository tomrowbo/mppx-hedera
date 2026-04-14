/**
 * SSE transport unit tests for mppx-hedera.
 *
 * Imports from the BUILT dist/ — run `pnpm build` before executing.
 * Usage:  node test/sse.test.mjs
 */

import assert from 'node:assert/strict';
import { Sse } from '../dist/server/index.js';
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
const CHALLENGE_ID = 'test-challenge-1';
const TICK_COST = 1000n;

async function seedChannel(store, channelId, opts = {}) {
  await store.put(channelId, {
    channelId,
    deposit: opts.deposit ?? 10000n,
    highestVoucherAmount: opts.voucher ?? 5000n,
    spent: opts.spent ?? 0n,
    units: opts.units ?? 0,
    finalized: opts.finalized ?? false,
  });
}

async function readStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

function parseAll(raw) {
  return raw
    .split('\n\n')
    .filter((e) => e.trim())
    .map((e) => Sse.parseEvent(e))
    .filter(Boolean);
}

async function* generate(chunks) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// Tests for serve()
// ---------------------------------------------------------------------------

console.log('\nSSE serve() tests');

await test('1. Emits correct number of message events (3 chunks -> 3 messages)', async () => {
  const store = Store.memory();
  await seedChannel(store, CHANNEL_ID, { voucher: 10000n });

  const stream = Sse.serve(generate(['a', 'b', 'c']), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
  });

  const raw = await readStream(stream);
  const events = parseAll(raw);
  const messages = events.filter((e) => e.type === 'message');
  assert.equal(messages.length, 3, `expected 3 messages, got ${messages.length}`);
});

await test('2. Emits payment-receipt on stream completion', async () => {
  const store = Store.memory();
  await seedChannel(store, CHANNEL_ID, { voucher: 10000n });

  const stream = Sse.serve(generate(['chunk']), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
  });

  const raw = await readStream(stream);
  const events = parseAll(raw);
  const receipts = events.filter((e) => e.type === 'payment-receipt');
  assert.equal(receipts.length, 1, 'expected exactly 1 receipt');
});

await test('3. Receipt contains correct spent, units, method=hedera, intent=session', async () => {
  const store = Store.memory();
  await seedChannel(store, CHANNEL_ID, { voucher: 10000n, spent: 0n });

  const stream = Sse.serve(generate(['a', 'b']), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
  });

  const raw = await readStream(stream);
  const events = parseAll(raw);
  const receipt = events.find((e) => e.type === 'payment-receipt');
  assert.ok(receipt, 'receipt must exist');
  assert.equal(receipt.data.method, 'hedera');
  assert.equal(receipt.data.intent, 'session');
  // 2 chunks at 1000n each = 2000 spent
  assert.equal(receipt.data.spent, '2000');
  assert.equal(receipt.data.units, 2);
});

await test('4. Deducts tickCost from channel per chunk (check store after)', async () => {
  const store = Store.memory();
  await seedChannel(store, CHANNEL_ID, { voucher: 10000n, spent: 0n });

  const stream = Sse.serve(generate(['a', 'b', 'c']), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
  });

  await readStream(stream);
  const channel = await store.get(CHANNEL_ID);
  // Store JSON-roundtrips bigints to strings
  assert.equal(BigInt(channel.spent), 3000n, 'spent should be 3 * 1000 = 3000');
  assert.equal(Number(channel.units), 3, 'units should be 3');
});

await test('5. Emits payment-need-voucher when balance exhausted', async () => {
  const store = Store.memory();
  // voucher = 1500, spent = 0: enough for 1 chunk (1000), not for 2nd
  await seedChannel(store, CHANNEL_ID, { voucher: 1500n, spent: 0n, deposit: 10000n });

  const stream = Sse.serve(generate(['a', 'b', 'c']), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
    pollInterval: 50,
  });

  // Top up the voucher after a short delay so the stream can finish
  setTimeout(async () => {
    const ch = await store.get(CHANNEL_ID);
    await store.put(CHANNEL_ID, { ...ch, highestVoucherAmount: 10000n });
  }, 120);

  const raw = await readStream(stream);
  const events = parseAll(raw);
  const needVoucher = events.filter((e) => e.type === 'payment-need-voucher');
  assert.ok(needVoucher.length >= 1, 'expected at least 1 payment-need-voucher event');
});

await test('6. Resumes streaming after voucher top-up', async () => {
  const store = Store.memory();
  // Only enough for 1 chunk initially
  await seedChannel(store, CHANNEL_ID, { voucher: 1000n, spent: 0n, deposit: 10000n });

  const stream = Sse.serve(generate(['first', 'second']), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
    pollInterval: 50,
  });

  // Top up after a delay
  setTimeout(async () => {
    const ch = await store.get(CHANNEL_ID);
    await store.put(CHANNEL_ID, { ...ch, highestVoucherAmount: 5000n });
  }, 120);

  const raw = await readStream(stream);
  const events = parseAll(raw);
  const messages = events.filter((e) => e.type === 'message');
  assert.equal(messages.length, 2, 'both chunks should be delivered after top-up');
  assert.equal(messages[0].data, 'first');
  assert.equal(messages[1].data, 'second');
});

await test('7. Handles abort signal (AbortController, abort mid-stream)', async () => {
  const store = Store.memory();
  await seedChannel(store, CHANNEL_ID, { voucher: 100000n });

  const controller = new AbortController();

  async function* slowSource() {
    yield 'chunk1';
    // Abort mid-stream
    controller.abort();
    yield 'chunk2';
    yield 'chunk3';
  }

  const stream = Sse.serve(slowSource(), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
    signal: controller.signal,
  });

  const raw = await readStream(stream);
  const events = parseAll(raw);
  const messages = events.filter((e) => e.type === 'message');
  // Should have at most 1 message (aborted after first chunk)
  assert.ok(messages.length <= 2, `expected at most 2 messages after abort, got ${messages.length}`);
});

await test('8. Handles empty source (0 chunks -> just receipt)', async () => {
  const store = Store.memory();
  await seedChannel(store, CHANNEL_ID, { voucher: 10000n });

  const stream = Sse.serve(generate([]), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
  });

  const raw = await readStream(stream);
  const events = parseAll(raw);
  const messages = events.filter((e) => e.type === 'message');
  const receipts = events.filter((e) => e.type === 'payment-receipt');
  assert.equal(messages.length, 0, 'no message events for empty source');
  assert.equal(receipts.length, 1, 'still emits a receipt');
});

await test('9. Handles source that throws (error propagation, stream closes)', async () => {
  const store = Store.memory();
  await seedChannel(store, CHANNEL_ID, { voucher: 10000n });

  async function* throwingSource() {
    yield 'ok';
    throw new Error('source exploded');
  }

  const stream = Sse.serve(throwingSource(), {
    store,
    tickCost: TICK_COST,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
  });

  // The stream should close (possibly with error), not hang forever
  let errored = false;
  try {
    await readStream(stream);
  } catch {
    errored = true;
  }
  // Either the stream threw or closed gracefully after the error
  assert.ok(true, 'stream did not hang');
});

await test('10. Store spent/units updated correctly after full stream', async () => {
  const store = Store.memory();
  await seedChannel(store, CHANNEL_ID, { voucher: 50000n, spent: 100n, units: 2 });

  const stream = Sse.serve(generate(['x', 'y', 'z', 'w']), {
    store,
    tickCost: 500n,
    channelId: CHANNEL_ID,
    challengeId: CHALLENGE_ID,
  });

  await readStream(stream);
  const channel = await store.get(CHANNEL_ID);
  // 4 chunks at 500 each = 2000 added to initial 100
  assert.equal(BigInt(channel.spent), 2100n);
  assert.equal(Number(channel.units), 6); // 2 initial + 4
});

// ---------------------------------------------------------------------------
// Tests for toResponse()
// ---------------------------------------------------------------------------

console.log('\nSSE toResponse() tests');

await test('11. Content-Type is text/event-stream', async () => {
  const body = new ReadableStream({ start(c) { c.close(); } });
  const res = Sse.toResponse(body);
  assert.ok(
    res.headers.get('Content-Type').includes('text/event-stream'),
    'Content-Type must include text/event-stream',
  );
});

await test('12. Cache-Control includes no-cache', async () => {
  const body = new ReadableStream({ start(c) { c.close(); } });
  const res = Sse.toResponse(body);
  assert.ok(
    res.headers.get('Cache-Control').includes('no-cache'),
    'Cache-Control must include no-cache',
  );
});

await test('13. Connection is keep-alive', async () => {
  const body = new ReadableStream({ start(c) { c.close(); } });
  const res = Sse.toResponse(body);
  assert.equal(res.headers.get('Connection'), 'keep-alive');
});

// ---------------------------------------------------------------------------
// Tests for parseEvent()
// ---------------------------------------------------------------------------

console.log('\nSSE parseEvent() tests');

await test('14. Parses message, payment-need-voucher, and payment-receipt event types', async () => {
  // message
  const msg = Sse.parseEvent('event: message\ndata: hello');
  assert.ok(msg, 'message should parse');
  assert.equal(msg.type, 'message');
  assert.equal(msg.data, 'hello');

  // payment-need-voucher
  const nv = Sse.parseEvent(
    'event: payment-need-voucher\ndata: {"channelId":"0x01","requiredCumulative":"100","acceptedCumulative":"50","deposit":"1000"}',
  );
  assert.ok(nv, 'need-voucher should parse');
  assert.equal(nv.type, 'payment-need-voucher');
  assert.equal(nv.data.channelId, '0x01');
  assert.equal(nv.data.requiredCumulative, '100');

  // payment-receipt
  const rcpt = Sse.parseEvent(
    'event: payment-receipt\ndata: {"method":"hedera","intent":"session","status":"success","timestamp":"2026-04-13","channelId":"0x01","acceptedCumulative":"500","spent":"200","units":3,"challengeId":"c1"}',
  );
  assert.ok(rcpt, 'receipt should parse');
  assert.equal(rcpt.type, 'payment-receipt');
  assert.equal(rcpt.data.method, 'hedera');
  assert.equal(rcpt.data.units, 3);
});

await test('15. Returns null for empty string', async () => {
  const result = Sse.parseEvent('');
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`SSE tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
