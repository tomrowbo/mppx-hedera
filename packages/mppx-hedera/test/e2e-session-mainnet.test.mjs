/**
 * Session E2E on MAINNET — real Circle USDC, full lifecycle including CLOSE.
 *
 * approve → open → voucher × 3 → CLOSE → finality check
 * Cost: ~0.01 USDC deposit (settled on close)
 *
 * Usage: node test/e2e-session-mainnet.test.mjs
 */

import { Mppx } from 'mppx/server';
import { Challenge, Credential, Receipt } from 'mppx';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const serverMod = await import('../dist/server/index.js');
const clientMod = await import('../dist/client/index.js');
const rootMod = await import('../dist/index.js');

const { hedera } = serverMod;
const { hederaSession } = clientMod;
const {
  hederaMainnet,
  HEDERA_STREAM_CHANNEL_MAINNET,
  USDC_MAINNET,
  VOUCHER_DOMAIN_NAME,
  VOUCHER_DOMAIN_VERSION,
  VOUCHER_TYPES,
} = rootMod;

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

function decodeCredential(serialized) {
  const b64 = serialized.replace('Payment ', '');
  return JSON.parse(Buffer.from(b64, 'base64url').toString());
}

async function signCloseVoucher(channelId, cumulativeAmount) {
  const walletClient = createWalletClient({
    account: OPERATOR_ACCOUNT,
    chain: hederaMainnet,
    transport: http('https://mainnet.hashio.io/api'),
  });
  return walletClient.signTypedData({
    account: OPERATOR_ACCOUNT,
    domain: {
      name: VOUCHER_DOMAIN_NAME,
      version: VOUCHER_DOMAIN_VERSION,
      chainId: 295,
      verifyingContract: ESCROW,
    },
    types: VOUCHER_TYPES,
    primaryType: 'Voucher',
    message: { channelId, cumulativeAmount },
  });
}

async function testSessionMainnet() {
  console.log('\n═══ MAINNET SESSION E2E: approve → open → voucher × 3 → CLOSE ═══');

  console.log('  [1/7] Creating mppx server (mainnet)...');
  const serverHandler = hedera.session({
    account: OPERATOR_ACCOUNT,
    recipient: PAYEE,
    escrowContract: ESCROW,
    currency: TOKEN,
    amount: '0.001',
    suggestedDeposit: '0.01',
    decimals: 6,
    unitType: 'request',
    testnet: false,
  });

  const mppx = Mppx.create({
    methods: [serverHandler],
    realm: SERVER_ID,
    secretKey: SECRET_KEY,
  });

  const route = mppx.session({
    amount: '0.001', currency: TOKEN, decimals: 6, unitType: 'request',
    recipient: PAYEE, suggestedDeposit: '0.01', escrowContract: ESCROW,
  });

  // Step 2: 402
  console.log('  [2/7] GET → 402...');
  const cr = await route(new Request(RESOURCE_URL));
  assert(cr.status === 402, `Got 402`);
  const challenge = Challenge.fromResponse(cr.challenge);
  assert(challenge.intent === 'session', `Intent is session`);

  // Step 3: Open (real mainnet)
  console.log('  [3/7] Client opening channel on MAINNET (real Circle USDC)...');
  const clientHandler = hederaSession({
    account: OPERATOR_ACCOUNT,
    deposit: '0.01',
    rpcUrl: 'https://mainnet.hashio.io/api',
  });

  let openCred;
  try {
    openCred = await clientHandler.createCredential({ challenge });
    assert(!!openCred, 'Open credential created');
  } catch (e) {
    assert(false, `Open failed: ${e.message}`);
    return;
  }

  // Step 4: Server verifies open
  console.log('  [4/7] Server verifying open...');
  const openResult = await route(new Request(RESOURCE_URL, {
    headers: { Authorization: openCred },
  }));
  assert(openResult.status === 200, `Open: got 200 (got ${openResult.status})`);
  if (openResult.status !== 200) return;

  const openParsed = decodeCredential(openCred);
  const channelId = openParsed.payload.channelId;
  console.log(`  Channel: ${channelId}`);

  // Step 5: 3 vouchers
  console.log('  [5/7] 3 vouchers (off-chain)...');
  for (let i = 1; i <= 3; i++) {
    const vcr = await route(new Request(RESOURCE_URL));
    const vch = Challenge.fromResponse(vcr.challenge);
    const vcred = await clientHandler.createCredential({ challenge: vch });
    const vr = await route(new Request(RESOURCE_URL, { headers: { Authorization: vcred } }));
    assert(vr.status === 200, `Voucher ${i}: got 200`);
  }

  // Step 6: CLOSE (real on-chain)
  console.log('  [6/7] Closing channel on MAINNET (real on-chain settlement)...');
  const finalCumulative = BigInt(challenge.request.amount) * 4n;
  const closeSig = await signCloseVoucher(channelId, finalCumulative);

  const closeCr = await route(new Request(RESOURCE_URL));
  const closeCh = Challenge.fromResponse(closeCr.challenge);
  const closeCred = Credential.from({
    challenge: closeCh,
    payload: {
      action: 'close',
      channelId,
      cumulativeAmount: String(finalCumulative),
      signature: closeSig,
    },
  });

  const closeResult = await route(new Request(RESOURCE_URL, {
    headers: { Authorization: Credential.serialize(closeCred) },
  }));
  assert(closeResult.status === 200, `Close: got 200 (got ${closeResult.status})`);

  if (closeResult.status === 200) {
    const closeResponse = closeResult.withReceipt(new Response('closed'));
    const closeReceipt = Receipt.fromResponse(closeResponse);
    assert(closeReceipt.method === 'hedera', `Close receipt method=hedera`);
    assert(closeReceipt.status === 'success', `Close receipt status=success`);
    console.log(`  Close tx: ${closeReceipt.reference}`);
  }

  // Step 7: Finality check
  console.log('  [7/7] Verifying channel is finalized...');
  const postCr = await route(new Request(RESOURCE_URL));
  const postCh = Challenge.fromResponse(postCr.challenge);
  const postVoucher = Credential.from({
    challenge: postCh,
    payload: {
      action: 'voucher', channelId,
      cumulativeAmount: String(finalCumulative + 1000n),
      signature: await signCloseVoucher(channelId, finalCumulative + 1000n),
    },
  });
  const postResult = await route(new Request(RESOURCE_URL, {
    headers: { Authorization: Credential.serialize(postVoucher) },
  }));
  assert(postResult.status === 402, `Post-close rejected with 402`);
}

async function main() {
  console.log('mppx-hedera — MAINNET Session E2E');
  console.log('Full lifecycle: approve → open → voucher × 3 → CLOSE → finality');
  console.log('Real Circle USDC on Hedera mainnet\n');

  await testSessionMainnet();

  console.log(`\n═══ FINAL ═══`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ MAINNET SESSION E2E PASSED' : '❌ ' + failed + ' TESTS FAILED'}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
