/**
 * TRUE end-to-end test on MAINNET — real money, real USDC, no mocks.
 *
 * mppx server → 402 → real Hedera mainnet tx → Mirror Node verify → 200 + receipt
 *
 * Costs ~0.000001 USDC per charge test (~$0.000001).
 *
 * Usage: node test/e2e-mainnet.test.mjs
 */

import { Mppx } from 'mppx/server';
import { Challenge, Credential, Receipt } from 'mppx';
import {
  Client as HederaClient,
  TransferTransaction,
  AccountId,
  TokenId,
  PrivateKey,
} from '@hiero-ledger/sdk';

const serverMod = await import('../dist/server/index.js');
const rootMod = await import('../dist/index.js');
const { hedera } = serverMod;
const { Attribution } = rootMod;

// ─── Mainnet config ──────────────────────────────────────────────
const OPERATOR_ID = '0.0.10430532';
const OPERATOR_KEY = '532933e45b6429bb1a73a1f64e1d09e62c3154f2b0856308e2ba0e99f6352f5c';
const ESCROW_ID = '0.0.10430730'; // HederaStreamChannel mainnet
const SERVER_ID = 'e2e-mainnet.hedera-mpp.dev';
const SECRET_KEY = 'e2e-mainnet-secret-key-32chars-minimum!!';
const TOKEN_ID = '0.0.456858'; // Circle USDC mainnet
const RESOURCE_URL = 'https://e2e-mainnet.hedera-mpp.dev/api/data';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

async function testPushModeMainnet() {
  console.log('\n═══ MAINNET E2E: Push mode charge ═══');

  // Step 1: Create mppx server
  console.log('  [1/7] Creating mppx server (mainnet)...');
  const mppx = Mppx.create({
    methods: [
      hedera.charge({
        serverId: SERVER_ID,
        recipient: ESCROW_ID,
        testnet: false, // MAINNET
        maxRetries: 15,
        retryDelay: 2000,
      }),
    ],
    realm: SERVER_ID,
    secretKey: SECRET_KEY,
  });

  const route = mppx.charge({
    amount: '0.000001',
    currency: TOKEN_ID,
    decimals: 6,
    recipient: ESCROW_ID,
  });

  // Step 2: Get 402
  console.log('  [2/7] GET → 402...');
  const challengeResult = await route(new Request(RESOURCE_URL));
  assert(challengeResult.status === 402, `Got 402`);

  // Step 3: Parse challenge
  console.log('  [3/7] Parsing challenge...');
  const challenge = Challenge.fromResponse(challengeResult.challenge);
  assert(challenge.method === 'hedera', `Method is hedera`);
  assert(challenge.intent === 'charge', `Intent is charge`);

  const chainId = challenge.request.methodDetails?.chainId ?? challenge.request.chainId;
  console.log(`  Challenge: amount=${challenge.request.amount}, chainId=${chainId}`);

  // Step 4: Real mainnet transaction
  console.log('  [4/7] Submitting REAL mainnet USDC transfer...');
  const memo = Attribution.encode({ challengeId: challenge.id, serverId: SERVER_ID });

  const key = PrivateKey.fromStringECDSA(OPERATOR_KEY);
  const client = HederaClient.forMainnet();
  client.setOperator(AccountId.fromString(OPERATOR_ID), key);

  const amount = Number(BigInt(challenge.request.amount));
  const tx = new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(TOKEN_ID), AccountId.fromString(OPERATOR_ID), -amount)
    .addTokenTransfer(TokenId.fromString(TOKEN_ID), AccountId.fromString(challenge.request.recipient), amount)
    .setTransactionMemo(memo)
    .freezeWith(client);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const transactionId = response.transactionId.toString();

  assert(receipt.status.toString() === 'SUCCESS', `Mainnet tx SUCCESS: ${transactionId}`);
  client.close();

  // Step 5: Build credential
  console.log('  [5/7] Building credential...');
  const credential = Credential.from({
    challenge,
    payload: { type: 'hash', transactionId },
  });
  const serialized = Credential.serialize(credential);

  // Step 6: Verify through mppx
  console.log('  [6/7] Sending to mppx server (Mirror Node verify)...');
  const authedRequest = new Request(RESOURCE_URL, {
    headers: { Authorization: serialized },
  });
  const verifyResult = await route(authedRequest);
  assert(verifyResult.status === 200, `Got 200 (got ${verifyResult.status})`);

  if (verifyResult.status !== 200) {
    console.log('  ⚠️  Verification failed');
    return;
  }

  // Step 7: Receipt
  console.log('  [7/7] Checking Payment-Receipt...');
  const httpResponse = verifyResult.withReceipt(new Response('OK'));
  const parsedReceipt = Receipt.fromResponse(httpResponse);
  assert(parsedReceipt.method === 'hedera', `Receipt method=hedera`);
  assert(parsedReceipt.status === 'success', `Receipt status=success`);
  assert(parsedReceipt.reference === transactionId, `Receipt reference matches`);

  console.log('  Receipt:', JSON.stringify(parsedReceipt));
  console.log(`\n  🔗 Verify on Hashscan: https://hashscan.io/mainnet/transaction/${transactionId.replace('@', '-').replace(/\.(?=\d+$)/, '-')}`);

  // Replay
  console.log('\n  [Replay] Same credential again...');
  const replayResult = await route(new Request(RESOURCE_URL, { headers: { Authorization: serialized } }));
  assert(replayResult.status === 402, `Replay rejected with 402`);
}

async function main() {
  console.log('mppx-hedera — MAINNET End-to-End Test');
  console.log('Real mppx server + real Hedera MAINNET + real Circle USDC');
  console.log('Cost: ~$0.000001 per test\n');

  await testPushModeMainnet();

  console.log(`\n═══ FINAL ═══`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ MAINNET E2E PASSED' : '❌ ' + failed + ' TESTS FAILED'}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
