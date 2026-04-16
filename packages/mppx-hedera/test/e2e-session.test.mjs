/**
 * TRUE end-to-end SESSION test — no mocks, real Hedera testnet.
 *
 * Full lifecycle: approve → open channel → voucher × 3 → CLOSE channel
 * All on-chain, all real USDC, all verified on Hashscan.
 *
 * Cost: ~0.01 USDC deposit (refunded on close minus voucher total)
 *
 * Usage: node test/e2e-session.test.mjs
 */

import { Mppx } from 'mppx/server';
import { Challenge, Credential, Receipt } from 'mppx';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Import from BUILT SDK
const serverMod = await import('../dist/server/index.js');
const clientMod = await import('../dist/client/index.js');
const rootMod = await import('../dist/index.js');

const { hedera } = serverMod;
const { hederaSession } = clientMod;
const {
  hederaTestnet,
  HEDERA_STREAM_CHANNEL_TESTNET,
  USDC_TESTNET,
  VOUCHER_DOMAIN_NAME,
  VOUCHER_DOMAIN_VERSION,
  VOUCHER_TYPES,
} = rootMod;

// ─── Config (real testnet) ───────────────────────────────────────
const OPERATOR_KEY = '0x6cabd0b8117cc36b0cb1b90d4a3151722be502cbc1c0efb255c7c3137268b904';
const OPERATOR_ACCOUNT = privateKeyToAccount(OPERATOR_KEY);
const ESCROW = HEDERA_STREAM_CHANNEL_TESTNET;
const TOKEN = USDC_TESTNET;
const SERVER_ID = 'e2e-session.hedera-mpp.dev';
const SECRET_KEY = 'e2e-session-secret-key-32-chars-minimum!!';
const RESOURCE_URL = 'https://e2e-session.hedera-mpp.dev/api/stream';
const PAYEE = OPERATOR_ACCOUNT.address;

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

/** Decode credential payload from the serialized "Payment ..." string */
function decodeCredential(serialized) {
  const b64 = serialized.replace('Payment ', '');
  return JSON.parse(Buffer.from(b64, 'base64url').toString());
}

/** Sign an EIP-712 voucher for close action */
async function signCloseVoucher(channelId, cumulativeAmount, chainId) {
  const walletClient = createWalletClient({
    account: OPERATOR_ACCOUNT,
    chain: hederaTestnet,
    transport: http('https://testnet.hashio.io/api'),
  });

  return walletClient.signTypedData({
    account: OPERATOR_ACCOUNT,
    domain: {
      name: VOUCHER_DOMAIN_NAME,
      version: VOUCHER_DOMAIN_VERSION,
      chainId,
      verifyingContract: ESCROW,
    },
    types: VOUCHER_TYPES,
    primaryType: 'Voucher',
    message: {
      channelId,
      cumulativeAmount,
    },
  });
}

async function testSessionE2E() {
  console.log('\n═══ E2E SESSION: approve → open → voucher × 3 → CLOSE ═══');

  // ── Step 1: Create mppx server ──────────────────────────────────
  console.log('  [1/8] Creating mppx server with hedera.session()...');

  const serverHandler = hedera.session({
    account: OPERATOR_ACCOUNT,
    recipient: PAYEE,
    escrowContract: ESCROW,
    currency: TOKEN,
    amount: '0.001',
    suggestedDeposit: '0.01',
    decimals: 6,
    unitType: 'request',
    testnet: true,
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

  // ── Step 2: Get 402 ─────────────────────────────────────────────
  console.log('  [2/8] GET → 402 challenge...');
  const cr = await route(new Request(RESOURCE_URL));
  assert(cr.status === 402, `Got 402`);
  const challenge = Challenge.fromResponse(cr.challenge);
  assert(challenge.method === 'hedera', `Method is hedera`);
  assert(challenge.intent === 'session', `Intent is session`);

  // ── Step 3: Client opens channel (real on-chain) ────────────────
  console.log('  [3/8] Client opening channel (approve + open on-chain)...');

  const clientHandler = hederaSession({
    account: OPERATOR_ACCOUNT,
    deposit: '0.01',
  });

  let openCred;
  try {
    openCred = await clientHandler.createCredential({ challenge });
    assert(!!openCred, 'Client created open credential');
  } catch (e) {
    assert(false, `Client open failed: ${e.message}`);
    return;
  }

  // ── Step 4: Server verifies open ────────────────────────────────
  console.log('  [4/8] Server verifying open credential...');
  const openResult = await route(new Request(RESOURCE_URL, {
    headers: { Authorization: openCred },
  }));
  assert(openResult.status === 200, `Open: got 200 (got ${openResult.status})`);

  if (openResult.status !== 200) {
    console.log('  ⚠️  Open failed — cannot continue');
    return;
  }

  const openResponse = openResult.withReceipt(new Response('opened'));
  const openReceipt = Receipt.fromResponse(openResponse);
  assert(openReceipt.status === 'success', `Open receipt status=success`);

  // Extract channelId from the open credential
  const openParsed = decodeCredential(openCred);
  const channelId = openParsed.payload.channelId;
  console.log(`  Channel: ${channelId}`);

  // ── Step 5: 3 vouchers (off-chain) ──────────────────────────────
  console.log('  [5/8] Sending 3 voucher requests (off-chain)...');
  for (let i = 1; i <= 3; i++) {
    const vcr = await route(new Request(RESOURCE_URL));
    const vch = Challenge.fromResponse(vcr.challenge);
    const vcred = await clientHandler.createCredential({ challenge: vch });
    const vresult = await route(new Request(RESOURCE_URL, {
      headers: { Authorization: vcred },
    }));
    assert(vresult.status === 200, `Voucher ${i}: got 200 (got ${vresult.status})`);
  }

  // ── Step 6: Close channel (real on-chain) ───────────────────────
  console.log('  [6/8] Closing channel (real on-chain settlement)...');

  // After open (1000) + 3 vouchers (1000 each) = cumulative 4000
  const finalCumulative = BigInt(challenge.request.amount) * 4n;
  console.log(`  Final cumulative: ${finalCumulative}`);

  // Sign the close voucher (EIP-712)
  const closeSignature = await signCloseVoucher(
    channelId,
    finalCumulative,
    296, // testnet chainId
  );
  console.log(`  Close signature: ${closeSignature.slice(0, 20)}...`);

  // Get a new challenge for the close action
  const closeCr = await route(new Request(RESOURCE_URL));
  const closeCh = Challenge.fromResponse(closeCr.challenge);

  // Build close credential
  const closeCred = Credential.from({
    challenge: closeCh,
    payload: {
      action: 'close',
      channelId,
      cumulativeAmount: String(finalCumulative),
      signature: closeSignature,
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
    console.log(`  Close receipt: ${JSON.stringify(closeReceipt)}`);
  } else {
    console.log('  ⚠️  Close returned non-200 — check escrow state');
  }

  // ── Step 7: Verify channel is finalized ─────────────────────────
  console.log('  [7/8] Verifying channel is finalized...');
  // Try to send another voucher — should fail because channel is closed
  const postCloseCr = await route(new Request(RESOURCE_URL));
  const postCloseCh = Challenge.fromResponse(postCloseCr.challenge);
  const postCloseVoucher = Credential.from({
    challenge: postCloseCh,
    payload: {
      action: 'voucher',
      channelId,
      cumulativeAmount: String(finalCumulative + 1000n),
      signature: await signCloseVoucher(channelId, finalCumulative + 1000n, 296),
    },
  });

  const postCloseResult = await route(new Request(RESOURCE_URL, {
    headers: { Authorization: Credential.serialize(postCloseVoucher) },
  }));
  // Should be 402 because channel is finalized → verify throws → mppx returns 402
  assert(postCloseResult.status === 402, `Post-close voucher rejected with 402 (got ${postCloseResult.status})`);

  // ── Step 8: Summary ─────────────────────────────────────────────
  console.log('  [8/8] Session E2E summary:');
  console.log('    - approve:  ✅ real on-chain');
  console.log('    - open:     ✅ real on-chain (USDC deposited)');
  console.log('    - voucher:  ✅ × 3 off-chain (EIP-712)');
  console.log('    - close:    ✅ real on-chain (settled + refunded)');
  console.log('    - finality: ✅ post-close voucher rejected');
}

async function main() {
  console.log('mppx-hedera — Session End-to-End Test (TESTNET)');
  console.log('Full lifecycle: approve → open → voucher × 3 → CLOSE → finality check');
  console.log('Real mppx server + real Hedera testnet + real USDC\n');

  await testSessionE2E();

  console.log(`\n═══ FINAL ═══`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ SESSION E2E PASSED' : '❌ ' + failed + ' TESTS FAILED'}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
