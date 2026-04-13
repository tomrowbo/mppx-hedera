/**
 * Integration tests — imports from the BUILT SDK (dist/), not inline reimplementations.
 * Every code path that would run in production is exercised here.
 */

import { Store, Credential } from 'mppx';

// ─── Import from BUILT SDK ──────────────────────────────────────
const clientMod = await import('./dist/client/index.js');
const serverMod = await import('./dist/server/index.js');
const rootMod = await import('./dist/index.js');

const { charge: clientCharge } = clientMod;
const { hedera, Sse } = serverMod;
const { Attribution } = rootMod;

// ─── Config ──────────────────────────────────────────────────────
const OPERATOR_ID = '0.0.8569027';
const OPERATOR_KEY = '0x6cabd0b8117cc36b0cb1b90d4a3151722be502cbc1c0efb255c7c3137268b904';
const ESCROW_ID = '0.0.8600318';
const SERVER_ID = 'integration-test.hedera-mpp.dev';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

/** Decode the mppx credential string into {challenge, payload} */
function decodeCredential(serialized) {
  const b64 = serialized.replace('Payment ', '');
  return JSON.parse(Buffer.from(b64, 'base64url').toString());
}

// ─── Test 1: Attribution exports ─────────────────────────────────
function testAttributionExports() {
  console.log('\n═══ TEST 1: Attribution exports from root index ═══');

  assert(typeof Attribution.encode === 'function', 'Attribution.encode exists');
  assert(typeof Attribution.verifyChallengeBinding === 'function', 'verifyChallengeBinding exists');
  assert(typeof Attribution.verifyServer === 'function', 'verifyServer exists');

  const memo = Attribution.encode({ challengeId: 'test', serverId: 'srv' });
  assert(memo.length === 66, 'Memo is 66 chars');
  assert(Attribution.isMppMemo(memo), 'isMppMemo passes');
  assert(Attribution.verifyChallengeBinding(memo, 'test'), 'Challenge binding passes');
  assert(!Attribution.verifyChallengeBinding(memo, 'wrong'), 'Wrong challenge rejected');
  assert(Attribution.verifyServer(memo, 'srv'), 'Server fingerprint passes');
  assert(!Attribution.verifyServer(memo, 'wrong'), 'Wrong server rejected');
}

// ─── Test 2: SSE from real export ────────────────────────────────
async function testSseExport() {
  console.log('\n═══ TEST 2: SSE serve() from real server export ═══');

  const store = Store.memory();
  const channelId = '0x' + 'aa'.repeat(32);

  await store.put(channelId, {
    channelId, deposit: 10000n, highestVoucherAmount: 2000n,
    spent: 0n, units: 0, finalized: false,
  });

  async function* source() { yield 'chunk-1'; yield 'chunk-2'; }

  const stream = Sse.serve(source(), {
    store, channelId, challengeId: 'sse-test', tickCost: 1000n, pollInterval: 100,
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }

  const events = raw.split('\n\n').filter(e => e.trim()).map(e => Sse.parseEvent(e)).filter(Boolean);
  assert(events.filter(e => e.type === 'message').length === 2, 'SSE: 2 messages');
  assert(events.filter(e => e.type === 'payment-receipt').length === 1, 'SSE: 1 receipt');

  const receipt = events.find(e => e.type === 'payment-receipt')?.data;
  assert(receipt?.spent === '2000', 'SSE receipt spent=2000');
  assert(receipt?.units === 2, 'SSE receipt units=2');
  assert(receipt?.method === 'hedera', 'SSE receipt method=hedera');
}

// ─── Test 3: Server request() hook ───────────────────────────────
function testRequestHook() {
  console.log('\n═══ TEST 3: Server request() hook ═══');

  const handler = hedera.charge({
    serverId: SERVER_ID, recipient: ESCROW_ID, testnet: true,
  });

  assert(typeof handler.request === 'function', 'request() hook exists');

  const enriched = handler.request({ request: { amount: '1000' } });
  assert(enriched.chainId === 296, `chainId=296 (got ${enriched.chainId})`);
  assert(enriched.recipient === ESCROW_ID, `recipient set`);
  assert(enriched.currency === '0.0.5449', `currency=0.0.5449`);
}

// ─── Test 4+5: Push mode end-to-end ─────────────────────────────
async function testPushMode() {
  console.log('\n═══ TEST 4: Push mode — client → server (real testnet) ═══');

  const store = Store.memory();

  const client = clientCharge({
    operatorId: OPERATOR_ID, operatorKey: OPERATOR_KEY,
    network: 'testnet', mode: 'push',
  });

  const server = hedera.charge({
    serverId: SERVER_ID, recipient: ESCROW_ID,
    testnet: true, store, maxRetries: 10, retryDelay: 2000,
  });

  const challenge = {
    id: 'push-' + Date.now(),
    realm: SERVER_ID,
    method: 'hedera',
    intent: 'charge',
    request: {
      amount: '1', currency: '0.0.5449', recipient: ESCROW_ID, chainId: 296,
    },
    expires: new Date(Date.now() + 300000).toISOString(),
  };

  // Client creates credential
  console.log('  [Client] Creating push-mode credential...');
  let serialized;
  try {
    serialized = await client.createCredential({ challenge });
    assert(!!serialized, 'createCredential returned a value');
  } catch (e) {
    assert(false, `createCredential threw: ${e.message}`);
    return;
  }

  const decoded = decodeCredential(serialized);
  assert(decoded.payload.type === 'hash', 'Credential type=hash');
  assert(decoded.payload.transactionId.includes('@'), 'transactionId is Hedera format');
  console.log('  [Client] txId:', decoded.payload.transactionId);

  // Wait for Mirror Node
  console.log('  [Server] Waiting 6s for Mirror Node...');
  await new Promise(r => setTimeout(r, 6000));

  // Server verifies
  console.log('  [Server] Verifying...');
  try {
    const receipt = await server.verify({
      credential: { challenge, payload: decoded.payload },
    });
    assert(receipt.method === 'hedera', 'Receipt method=hedera');
    assert(receipt.status === 'success', 'Receipt status=success');
    assert(typeof receipt.reference === 'string', 'Receipt has reference');
    console.log('  [Server] Receipt:', JSON.stringify(receipt));
  } catch (e) {
    assert(false, `verify threw: ${e.message}`);
    console.log('  Stack:', e.stack?.split('\n').slice(0, 4).join('\n'));
    return;
  }

  // Test 5: Replay rejection
  console.log('\n═══ TEST 5: Replay rejection ═══');
  try {
    await server.verify({
      credential: { challenge, payload: decoded.payload },
    });
    assert(false, 'Should have thrown on replay');
  } catch (e) {
    const msg = e.message || e.reason || String(e);
    assert(msg.includes('already used'), `Replay rejected: ${msg}`);
  }
}

// ─── Test 6+7: Pull mode end-to-end ─────────────────────────────
async function testPullMode() {
  console.log('\n═══ TEST 6: Pull mode — client signs → server submits (real testnet) ═══');

  const store = Store.memory();

  const client = clientCharge({
    operatorId: OPERATOR_ID, operatorKey: OPERATOR_KEY,
    network: 'testnet', mode: 'pull',
  });

  const server = hedera.charge({
    serverId: SERVER_ID, recipient: ESCROW_ID,
    testnet: true, store,
    operatorId: OPERATOR_ID, operatorKey: OPERATOR_KEY,
  });

  const challenge = {
    id: 'pull-' + Date.now(),
    realm: SERVER_ID,
    method: 'hedera',
    intent: 'charge',
    request: {
      amount: '1', currency: '0.0.5449', recipient: ESCROW_ID, chainId: 296,
    },
    expires: new Date(Date.now() + 300000).toISOString(),
  };

  // Client creates credential (signs, does NOT submit)
  console.log('  [Client] Creating pull-mode credential...');
  let serialized;
  try {
    serialized = await client.createCredential({ challenge });
    assert(!!serialized, 'createCredential returned a value');
  } catch (e) {
    assert(false, `createCredential threw: ${e.message}`);
    return;
  }

  const decoded = decodeCredential(serialized);
  assert(decoded.payload.type === 'transaction', 'Credential type=transaction');
  assert(typeof decoded.payload.transaction === 'string', 'Has serialized tx bytes');
  console.log('  [Client] Serialized tx:', decoded.payload.transaction.length, 'base64 chars');

  // Server verifies (deserializes, checks memo, submits, waits)
  console.log('  [Server] Verifying (will submit to Hedera)...');
  try {
    const receipt = await server.verify({
      credential: { challenge, payload: decoded.payload },
    });
    assert(receipt.method === 'hedera', 'Receipt method=hedera');
    assert(receipt.status === 'success', 'Receipt status=success');
    assert(typeof receipt.reference === 'string', 'Receipt has reference');
    console.log('  [Server] Receipt:', JSON.stringify(receipt));
  } catch (e) {
    assert(false, `verify threw: ${e.message}`);
    console.log('  Stack:', e.stack?.split('\n').slice(0, 5).join('\n'));
  }
}

// ─── Run ─────────────────────────────────────────────────────────
async function main() {
  console.log('mppx-hedera v0.2.0 — Integration Tests (real SDK imports + real testnet)\n');

  // Offline tests first
  testAttributionExports();
  await testSseExport();
  testRequestHook();

  // Online tests (hit Hedera testnet)
  await testPushMode();
  await testPullMode();

  console.log(`\n═══ FINAL ═══`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ ALL INTEGRATION TESTS PASSED' : '❌ ' + failed + ' TESTS FAILED'}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
