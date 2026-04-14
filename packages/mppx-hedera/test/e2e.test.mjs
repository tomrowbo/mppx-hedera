/**
 * TRUE end-to-end test — no mocks, no manual wiring.
 *
 * mppx HTTP server → real 402 → real client createCredential → real Hedera tx → real verify → 200 + receipt
 *
 * This is the single script you run to know everything works.
 * Uses real Hedera testnet. Costs ~0.000001 USDC per charge test.
 *
 * Usage: node test/e2e.test.mjs
 */

import { Mppx } from 'mppx/server';
import { Challenge, Credential, Receipt } from 'mppx';
import {
  Client as HederaClient,
  TransferTransaction,
  AccountId,
  TokenId,
  PrivateKey,
} from '@hashgraph/sdk';

// Import from BUILT SDK
const serverMod = await import('../dist/server/index.js');
const rootMod = await import('../dist/index.js');

const { hedera } = serverMod;
const { Attribution } = rootMod;

// ─── Config (real testnet) ───────────────────────────────────────
const OPERATOR_ID = '0.0.8569027';
const OPERATOR_KEY = '6cabd0b8117cc36b0cb1b90d4a3151722be502cbc1c0efb255c7c3137268b904';
const ESCROW_ID = '0.0.8600318';
const SERVER_ID = 'e2e-test.hedera-mpp.dev';
const SECRET_KEY = 'e2e-test-secret-key-32-chars-minimum!!';
const TOKEN_ID = '0.0.5449';
const RESOURCE_URL = 'https://e2e-test.hedera-mpp.dev/api/data';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

// ─── TEST 1: Full push-mode charge through mppx HTTP stack ──────
async function testPushModeE2E() {
  console.log('\n═══ E2E TEST 1: Push mode charge — mppx server + real Hedera ═══');

  // ── Step 1: Create a real mppx server with our hedera.charge() ──
  console.log('  [1/7] Creating mppx server...');
  const mppx = Mppx.create({
    methods: [
      hedera.charge({
        serverId: SERVER_ID,
        recipient: ESCROW_ID,
        testnet: true,
        maxRetries: 15,
        retryDelay: 2000,
      }),
    ],
    realm: SERVER_ID,
    secretKey: SECRET_KEY,
  });

  // Get the route handler
  const route = mppx.charge({
    amount: '0.000001',
    currency: TOKEN_ID,
    decimals: 6,
    recipient: ESCROW_ID,
  });

  // ── Step 2: Send a GET request, get a real 402 ──────────────────
  console.log('  [2/7] Sending GET request → expecting 402...');
  const initialRequest = new Request(RESOURCE_URL);
  const challengeResult = await route(initialRequest);

  assert(challengeResult.status === 402, `Got 402 (got ${challengeResult.status})`);

  // ── Step 3: Parse the real challenge from WWW-Authenticate ──────
  console.log('  [3/7] Parsing challenge from WWW-Authenticate header...');
  const challenge = Challenge.fromResponse(challengeResult.challenge);

  assert(challenge.method === 'hedera', `Method is hedera`);
  assert(challenge.intent === 'charge', `Intent is charge`);
  assert(!!challenge.id, `Challenge has an ID: ${challenge.id.slice(0, 20)}...`);
  assert(!!challenge.realm, `Challenge has realm: ${challenge.realm}`);

  const chainId = challenge.request.methodDetails?.chainId ?? challenge.request.chainId;
  console.log(`  Challenge: amount=${challenge.request.amount}, recipient=${challenge.request.recipient}, chainId=${chainId}`);

  // ── Step 4: Build a REAL Hedera transaction with Attribution memo ─
  console.log('  [4/7] Building real Hedera TransferTransaction with Attribution memo...');

  const memo = Attribution.encode({
    challengeId: challenge.id,
    serverId: SERVER_ID,
  });

  const key = PrivateKey.fromStringECDSA(OPERATOR_KEY);
  const client = HederaClient.forTestnet();
  client.setOperator(AccountId.fromString(OPERATOR_ID), key);

  const amount = Number(BigInt(challenge.request.amount));
  const recipient = challenge.request.recipient;

  const tx = new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(TOKEN_ID), AccountId.fromString(OPERATOR_ID), -amount)
    .addTokenTransfer(TokenId.fromString(TOKEN_ID), AccountId.fromString(recipient), amount)
    .setTransactionMemo(memo)
    .freezeWith(client);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const transactionId = response.transactionId.toString();

  assert(receipt.status.toString() === 'SUCCESS', `Hedera tx SUCCESS: ${transactionId}`);
  client.close();

  // ── Step 5: Build credential with the REAL challenge + REAL tx ID ─
  console.log('  [5/7] Building credential from real challenge + real transaction...');

  const credential = Credential.from({
    challenge,
    payload: { type: 'hash', transactionId },
  });

  const serialized = Credential.serialize(credential);
  assert(serialized.startsWith('Payment '), 'Credential serializes to Payment scheme');

  // ── Step 6: Send authorized request through mppx server ─────────
  console.log('  [6/7] Sending authorized request → expecting 200...');
  console.log('  (waiting for Mirror Node indexing...)');

  const authedRequest = new Request(RESOURCE_URL, {
    headers: { Authorization: serialized },
  });

  const verifyResult = await route(authedRequest);

  assert(verifyResult.status === 200, `Got 200 (got ${verifyResult.status})`);

  if (verifyResult.status !== 200) {
    console.log('  ⚠️  Verification failed — dumping debug info:');
    console.log('    challengeId:', challenge.id);
    console.log('    transactionId:', transactionId);
    console.log('    memo:', memo);
    return;
  }

  // ── Step 7: Check Payment-Receipt header ────────────────────────
  console.log('  [7/7] Checking Payment-Receipt header...');

  const httpResponse = verifyResult.withReceipt(new Response('{"data": "success"}'));
  const receiptHeader = httpResponse.headers.get('Payment-Receipt');
  assert(!!receiptHeader, 'Payment-Receipt header present');

  const parsedReceipt = Receipt.fromResponse(httpResponse);
  assert(parsedReceipt.method === 'hedera', `Receipt method=hedera`);
  assert(parsedReceipt.status === 'success', `Receipt status=success`);
  assert(parsedReceipt.reference === transactionId, `Receipt reference matches txId`);

  console.log('  Receipt:', JSON.stringify(parsedReceipt));

  // ── Step 7b: Replay should be rejected ──────────────────────────
  console.log('\n  [Replay] Sending same credential again...');
  const replayRequest = new Request(RESOURCE_URL, {
    headers: { Authorization: serialized },
  });
  const replayResult = await route(replayRequest);
  assert(replayResult.status === 402, `Replay rejected with 402 (got ${replayResult.status})`);
}

// ─── TEST 2: Full pull-mode charge through mppx HTTP stack ──────
async function testPullModeE2E() {
  console.log('\n═══ E2E TEST 2: Pull mode charge — mppx server + real Hedera ═══');

  // ── Step 1: Create mppx server with pull-mode support ───────────
  console.log('  [1/6] Creating mppx server with pull-mode support...');
  const mppx = Mppx.create({
    methods: [
      hedera.charge({
        serverId: SERVER_ID,
        recipient: ESCROW_ID,
        testnet: true,
        operatorId: OPERATOR_ID,
        operatorKey: '0x' + OPERATOR_KEY,
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

  // ── Step 2: Get 402 challenge ───────────────────────────────────
  console.log('  [2/6] Getting 402 challenge...');
  const challengeResult = await route(new Request(RESOURCE_URL));
  assert(challengeResult.status === 402, `Got 402`);
  const challenge = Challenge.fromResponse(challengeResult.challenge);

  // ── Step 3: Build and SIGN (not submit) a Hedera transaction ────
  console.log('  [3/6] Signing transaction (not submitting — pull mode)...');

  const memo = Attribution.encode({ challengeId: challenge.id, serverId: SERVER_ID });
  const key = PrivateKey.fromStringECDSA(OPERATOR_KEY);
  const client = HederaClient.forTestnet();
  client.setOperator(AccountId.fromString(OPERATOR_ID), key);

  const amount = Number(BigInt(challenge.request.amount));
  const tx = new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(TOKEN_ID), AccountId.fromString(OPERATOR_ID), -amount)
    .addTokenTransfer(TokenId.fromString(TOKEN_ID), AccountId.fromString(challenge.request.recipient), amount)
    .setTransactionMemo(memo)
    .freezeWith(client);

  const signed = await tx.sign(key);
  const txBytes = signed.toBytes();
  const base64Tx = Buffer.from(txBytes).toString('base64');
  client.close();

  assert(base64Tx.length > 100, `Serialized tx: ${base64Tx.length} base64 chars`);

  // ── Step 4: Build credential with type="transaction" ────────────
  console.log('  [4/6] Building pull-mode credential...');
  const credential = Credential.from({
    challenge,
    payload: { type: 'transaction', transaction: base64Tx },
  });
  const serialized = Credential.serialize(credential);

  // ── Step 5: Send to mppx server (server will submit to Hedera) ──
  console.log('  [5/6] Sending to mppx server (server submits tx)...');
  const authedRequest = new Request(RESOURCE_URL, {
    headers: { Authorization: serialized },
  });
  const verifyResult = await route(authedRequest);

  assert(verifyResult.status === 200, `Got 200 (got ${verifyResult.status})`);

  // ── Step 6: Check receipt ───────────────────────────────────────
  if (verifyResult.status === 200) {
    console.log('  [6/6] Checking Payment-Receipt...');
    const httpResponse = verifyResult.withReceipt(new Response('OK'));
    const parsedReceipt = Receipt.fromResponse(httpResponse);
    assert(parsedReceipt.method === 'hedera', `Receipt method=hedera`);
    assert(parsedReceipt.status === 'success', `Receipt status=success`);
    assert(typeof parsedReceipt.reference === 'string', `Receipt has reference`);
    console.log('  Receipt:', JSON.stringify(parsedReceipt));
  }
}

// ─── Run ─────────────────────────────────────────────────────────
async function main() {
  console.log('mppx-hedera — TRUE End-to-End Tests');
  console.log('Real mppx server + real Hedera testnet + real transactions');
  console.log('No mocks. No manual wiring.\n');

  await testPushModeE2E();
  await testPullModeE2E();

  console.log(`\n═══ FINAL ═══`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ ALL E2E TESTS PASSED' : '❌ ' + failed + ' TESTS FAILED'}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
