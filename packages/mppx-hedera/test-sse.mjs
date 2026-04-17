/**
 * Test SSE transport for session metered streaming.
 *
 * Simulates the full flow without a real Hedera channel:
 * 1. Creates a mock channel state in an in-memory store
 * 2. Serves an async iterable through the SSE transport
 * 3. Verifies chunks are metered, need-voucher fires, and receipt is emitted
 */

// We test against the built dist since the source uses TS
const { Store } = await import('mppx');

// Import SSE from the built package
const Sse = await import('./dist/server/index.js').then(m => m.Sse);

// ─── Test helpers ────────────────────────────────────────────────
function readStream(stream) {
  return new Promise(async (resolve) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let result = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    resolve(result);
  });
}

// ─── Test 1: Basic metered streaming ─────────────────────────────
async function testBasicStreaming() {
  console.log('\n═══ TEST 1: Basic metered streaming ═══');

  const store = Store.memory();
  const channelId = '0x' + '01'.repeat(32);

  // Seed channel state with enough balance for 3 chunks at 1000 each
  await store.put(channelId, {
    channelId,
    deposit: 10000n,
    highestVoucherAmount: 3000n, // enough for 3 ticks
    spent: 0n,
    units: 0,
    finalized: false,
  });

  // Source: 3 chunks
  async function* source() {
    yield '{"content": "Hello"}';
    yield '{"content": " world"}';
    yield '{"content": "!"}';
  }

  const stream = Sse.serve(source(), {
    store,
    channelId,
    challengeId: 'test-challenge-1',
    tickCost: 1000n,
    pollInterval: 100,
  });

  const raw = await readStream(stream);
  console.log('  Raw SSE output:');
  for (const line of raw.split('\n')) {
    if (line.trim()) console.log('    ' + line);
  }

  // Parse events
  const events = raw.split('\n\n').filter(e => e.trim()).map(e => Sse.parseEvent(e)).filter(Boolean);

  const messages = events.filter(e => e.type === 'message');
  const receipts = events.filter(e => e.type === 'payment-receipt');
  const needVouchers = events.filter(e => e.type === 'payment-need-voucher');

  console.log(`\n  Messages: ${messages.length} ${messages.length === 3 ? '✅' : '❌ (expected 3)'}`);
  console.log(`  Receipts: ${receipts.length} ${receipts.length === 1 ? '✅' : '❌ (expected 1)'}`);
  console.log(`  Need-voucher: ${needVouchers.length} ${needVouchers.length === 0 ? '✅' : '❌ (expected 0)'}`);

  // Check receipt
  if (receipts.length) {
    const receipt = receipts[0].data;
    console.log(`  Receipt spent: ${receipt.spent} ${receipt.spent === '3000' ? '✅' : '❌ (expected 3000)'}`);
    console.log(`  Receipt units: ${receipt.units} ${receipt.units === 3 ? '✅' : '❌ (expected 3)'}`);
    console.log(`  Receipt method: ${receipt.method} ${receipt.method === 'hedera' ? '✅' : '❌'}`);
    console.log(`  Receipt intent: ${receipt.intent} ${receipt.intent === 'session' ? '✅' : '❌'}`);
  }

  // Check store was updated
  const finalChannel = await store.get(channelId);
  console.log(`  Store spent: ${finalChannel.spent} ${BigInt(finalChannel.spent) === 3000n ? '✅' : '❌'}`);
  console.log(`  Store units: ${finalChannel.units} ${finalChannel.units === 3 ? '✅' : '❌'}`);

  return messages.length === 3 && receipts.length === 1 && needVouchers.length === 0;
}

// ─── Test 2: Need-voucher event fires when balance exhausted ─────
async function testNeedVoucher() {
  console.log('\n═══ TEST 2: Need-voucher when balance exhausted ═══');

  const store = Store.memory();
  const channelId = '0x' + '02'.repeat(32);

  // Seed with balance for only 2 chunks
  await store.put(channelId, {
    channelId,
    deposit: 10000n,
    highestVoucherAmount: 2000n, // only enough for 2 ticks
    spent: 0n,
    units: 0,
    finalized: false,
  });

  // Source: 4 chunks (more than balance allows)
  let chunkIndex = 0;
  async function* source() {
    yield '{"chunk": 1}';
    chunkIndex++;
    yield '{"chunk": 2}';
    chunkIndex++;
    yield '{"chunk": 3}'; // this one should trigger need-voucher
    chunkIndex++;
    yield '{"chunk": 4}';
    chunkIndex++;
  }

  // After a short delay, simulate a voucher top-up
  const topUpDelay = setTimeout(async () => {
    const channel = await store.get(channelId);
    if (channel) {
      await store.put(channelId, {
        ...channel,
        highestVoucherAmount: 5000n, // top up to cover remaining
      });
    }
  }, 500);

  const abortController = new AbortController();
  // Safety timeout
  const safetyTimeout = setTimeout(() => abortController.abort(), 10000);

  const stream = Sse.serve(source(), {
    store,
    channelId,
    challengeId: 'test-challenge-2',
    tickCost: 1000n,
    pollInterval: 200,
    signal: abortController.signal,
  });

  const raw = await readStream(stream);
  clearTimeout(topUpDelay);
  clearTimeout(safetyTimeout);

  const events = raw.split('\n\n').filter(e => e.trim()).map(e => Sse.parseEvent(e)).filter(Boolean);

  const messages = events.filter(e => e.type === 'message');
  const receipts = events.filter(e => e.type === 'payment-receipt');
  const needVouchers = events.filter(e => e.type === 'payment-need-voucher');

  console.log(`  Messages: ${messages.length} ${messages.length === 4 ? '✅' : '❌ (expected 4)'}`);
  console.log(`  Need-voucher events: ${needVouchers.length} ${needVouchers.length >= 1 ? '✅' : '❌ (expected >= 1)'}`);
  console.log(`  Receipts: ${receipts.length} ${receipts.length === 1 ? '✅' : '❌ (expected 1)'}`);

  if (needVouchers.length) {
    const nv = needVouchers[0].data;
    console.log(`  Need-voucher channelId: ${nv.channelId.slice(0, 10)}... ✅`);
    console.log(`  Need-voucher requiredCumulative: ${nv.requiredCumulative}`);
    console.log(`  Need-voucher acceptedCumulative: ${nv.acceptedCumulative}`);
  }

  if (receipts.length) {
    const receipt = receipts[0].data;
    console.log(`  Receipt spent: ${receipt.spent} ${receipt.spent === '4000' ? '✅' : '❌ (expected 4000)'}`);
    console.log(`  Receipt units: ${receipt.units} ${receipt.units === 4 ? '✅' : '❌ (expected 4)'}`);
  }

  return messages.length === 4 && needVouchers.length >= 1 && receipts.length === 1;
}

// ─── Test 3: toResponse creates correct headers ──────────────────
async function testToResponse() {
  console.log('\n═══ TEST 3: toResponse SSE headers ═══');

  const mockStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: message\ndata: test\n\n'));
      controller.close();
    }
  });

  const response = Sse.toResponse(mockStream);

  const ct = response.headers.get('content-type');
  const cc = response.headers.get('cache-control');
  const conn = response.headers.get('connection');

  console.log(`  Content-Type: ${ct} ${ct?.includes('text/event-stream') ? '✅' : '❌'}`);
  console.log(`  Cache-Control: ${cc} ${cc?.includes('no-cache') ? '✅' : '❌'}`);
  console.log(`  Connection: ${conn} ${conn === 'keep-alive' ? '✅' : '❌'}`);

  return ct?.includes('text/event-stream') && cc?.includes('no-cache') && conn === 'keep-alive';
}

// ─── Test 4: parseEvent handles all event types ──────────────────
function testParseEvent() {
  console.log('\n═══ TEST 4: parseEvent ═══');

  const msg = Sse.parseEvent('event: message\ndata: {"content": "hello"}');
  console.log(`  message:`, msg?.type === 'message' ? '✅' : '❌', msg?.data);

  const nv = Sse.parseEvent('event: payment-need-voucher\ndata: {"channelId":"0x01","requiredCumulative":"100","acceptedCumulative":"50","deposit":"1000"}');
  console.log(`  need-voucher:`, nv?.type === 'payment-need-voucher' ? '✅' : '❌', nv?.data?.channelId);

  const receipt = Sse.parseEvent('event: payment-receipt\ndata: {"method":"hedera","intent":"session","status":"success","timestamp":"2026-04-13T00:00:00Z","channelId":"0x01","acceptedCumulative":"100","spent":"100","units":10,"challengeId":"ch1"}');
  console.log(`  receipt:`, receipt?.type === 'payment-receipt' ? '✅' : '❌', receipt?.data?.units);

  const empty = Sse.parseEvent('');
  console.log(`  empty:`, empty === null ? '✅' : '❌');

  return msg?.type === 'message' && nv?.type === 'payment-need-voucher' && receipt?.type === 'payment-receipt' && empty === null;
}

// ─── Test 5: isEventStream ───────────────────────────────────────
function testIsEventStream() {
  console.log('\n═══ TEST 5: isEventStream ═══');

  const yes = Sse.isEventStream(new Response(null, { headers: { 'Content-Type': 'text/event-stream' } }));
  const no = Sse.isEventStream(new Response(null, { headers: { 'Content-Type': 'application/json' } }));

  console.log(`  text/event-stream: ${yes ? '✅' : '❌'}`);
  console.log(`  application/json: ${!no ? '✅' : '❌'}`);

  return yes && !no;
}

// ─── Run all tests ───────────────────────────────────────────────
async function main() {
  console.log('mppx-hedera SSE Transport Tests\n');

  const results = {};

  results['Basic streaming'] = await testBasicStreaming();
  results['Need-voucher'] = await testNeedVoucher();
  results['toResponse headers'] = await testToResponse();
  results['parseEvent'] = testParseEvent();
  results['isEventStream'] = testIsEventStream();

  console.log('\n═══ RESULTS ═══');
  let allPass = true;
  for (const [name, pass] of Object.entries(results)) {
    console.log(`  ${pass ? '✅' : '❌'} ${name}`);
    if (!pass) allPass = false;
  }
  console.log(`\n${allPass ? '✅ ALL SSE TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
}

main().catch(console.error);
