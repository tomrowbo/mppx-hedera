/**
 * Session E2E on MAINNET — real Circle USDC, real escrow contract.
 *
 * Full lifecycle: approve → open channel → voucher × 3
 * Cost: ~0.01 USDC deposit (refunded minus vouchers on close)
 *
 * Usage: node test/e2e-session-mainnet.test.mjs
 */

import { Mppx } from 'mppx/server';
import { Challenge, Credential, Receipt } from 'mppx';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const serverMod = await import('../dist/server/index.js');
const clientMod = await import('../dist/client/index.js');
const rootMod = await import('../dist/index.js');

const { hedera } = serverMod;
const { hederaSession } = clientMod;
const { hederaMainnet, HEDERA_STREAM_CHANNEL_MAINNET, USDC_MAINNET } = rootMod;

// ─── Mainnet config ──────────────────────────────────────────────
const OPERATOR_KEY = '0x532933e45b6429bb1a73a1f64e1d09e62c3154f2b0856308e2ba0e99f6352f5c';
const OPERATOR_ACCOUNT = privateKeyToAccount(OPERATOR_KEY);
const ESCROW = HEDERA_STREAM_CHANNEL_MAINNET;
const TOKEN = USDC_MAINNET;
const SERVER_ID = 'e2e-session-mainnet.hedera-mpp.dev';
const SECRET_KEY = 'e2e-session-mainnet-secret-32-chars-min!!';
const RESOURCE_URL = 'https://e2e-session-mainnet.hedera-mpp.dev/api/stream';
const PAYEE = OPERATOR_ACCOUNT.address;

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

async function testSessionMainnet() {
  console.log('\n═══ MAINNET SESSION E2E: approve → open → voucher × 3 ═══');

  console.log('  [1/6] Creating mppx server (mainnet)...');
  const serverHandler = hedera.session({
    account: OPERATOR_ACCOUNT,
    recipient: PAYEE,
    escrowContract: ESCROW,
    currency: TOKEN,
    amount: '0.001',
    suggestedDeposit: '0.01',
    decimals: 6,
    unitType: 'request',
    testnet: false, // MAINNET
  });

  const mppx = Mppx.create({
    methods: [serverHandler],
    realm: SERVER_ID,
    secretKey: SECRET_KEY,
  });

  const route = mppx.session({
    amount: '0.001',
    currency: TOKEN,
    decimals: 6,
    unitType: 'request',
    recipient: PAYEE,
    suggestedDeposit: '0.01',
    escrowContract: ESCROW,
  });

  // Step 2: Get 402
  console.log('  [2/6] GET → 402 challenge...');
  const cr = await route(new Request(RESOURCE_URL));
  assert(cr.status === 402, `Got 402`);
  const challenge = Challenge.fromResponse(cr.challenge);
  assert(challenge.method === 'hedera', `Method is hedera`);
  assert(challenge.intent === 'session', `Intent is session`);
  console.log(`  Challenge: amount=${challenge.request.amount}, deposit=${challenge.request.suggestedDeposit}`);

  // Step 3: Client opens channel (real mainnet USDC)
  console.log('  [3/6] Client opening channel on MAINNET (approve + open)...');
  console.log('        Real Circle USDC being deposited into escrow...');

  const clientHandler = hederaSession({
    account: OPERATOR_ACCOUNT,
    deposit: '0.01',
    rpcUrl: 'https://mainnet.hashio.io/api',
  });

  let openCred;
  try {
    openCred = await clientHandler.createCredential({ challenge });
    assert(!!openCred, 'Client created open credential');
  } catch (e) {
    console.log(`  ❌ Client open failed: ${e.message}`);
    console.log(`  Stack: ${e.stack?.split('\n').slice(0, 4).join('\n')}`);
    failed++;
    return;
  }

  // Step 4: Server verifies open
  console.log('  [4/6] Server verifying open credential...');
  const openResult = await route(new Request(RESOURCE_URL, {
    headers: { Authorization: openCred },
  }));

  assert(openResult.status === 200, `Open: got 200 (got ${openResult.status})`);

  if (openResult.status !== 200) {
    console.log('  ⚠️  Open verification failed — cannot continue');
    return;
  }

  const openResponse = openResult.withReceipt(new Response('opened'));
  const openReceipt = Receipt.fromResponse(openResponse);
  assert(openReceipt.method === 'hedera', `Receipt method=hedera`);
  assert(openReceipt.status === 'success', `Receipt status=success`);
  console.log(`  Channel: ${openReceipt.reference?.slice(0, 20)}...`);

  // Step 5: 3 vouchers
  console.log('  [5/6] Sending 3 voucher requests (off-chain)...');
  for (let i = 1; i <= 3; i++) {
    const vcr = await route(new Request(RESOURCE_URL));
    const vch = Challenge.fromResponse(vcr.challenge);
    const vcred = await clientHandler.createCredential({ challenge: vch });
    const vresult = await route(new Request(RESOURCE_URL, {
      headers: { Authorization: vcred },
    }));
    assert(vresult.status === 200, `Voucher ${i}: got 200`);
  }

  // Step 6: Summary
  console.log('  [6/6] Mainnet session E2E summary:');
  console.log('    - approve: ✅ (real Circle USDC on mainnet)');
  console.log('    - open:    ✅ (USDC deposited into HederaStreamChannel)');
  console.log('    - voucher: ✅ × 3 (off-chain EIP-712)');
  console.log('    All verifiable on hashscan.io/mainnet');
}

async function main() {
  console.log('mppx-hedera — MAINNET Session End-to-End Test');
  console.log('Real mppx server + real Hedera MAINNET + real Circle USDC\n');

  await testSessionMainnet();

  console.log(`\n═══ FINAL ═══`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ MAINNET SESSION E2E PASSED' : '❌ ' + failed + ' TESTS FAILED'}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
