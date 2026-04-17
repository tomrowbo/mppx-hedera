/**
 * Test suite for v0.2.0 features on Hedera testnet.
 *
 * Tests:
 * 1. Push mode charge with Attribution memo (already verified)
 * 2. Push mode charge with splits (multi-recipient)
 * 3. Pull mode charge (client signs, server submits)
 * 4. Attribution encoding/decoding roundtrip
 */

import {
  Client as HederaClient,
  TransferTransaction,
  AccountId,
  TokenId,
  PrivateKey,
  Transaction,
} from '@hiero-ledger/sdk';
import { keccak256, toBytes, toHex, hexToBytes } from 'viem';

// ─── Config ──────────────────────────────────────────────────────
const OPERATOR_ID = '0.0.8569027';
const OPERATOR_KEY = '6cabd0b8117cc36b0cb1b90d4a3151722be502cbc1c0efb255c7c3137268b904';
const ESCROW_ID = '0.0.8600318'; // HederaStreamChannel testnet (associated with USDC)
const USDC_TOKEN_ID = '0.0.5449';
const MIRROR_NODE = 'https://testnet.mirrornode.hedera.com';

// ─── Inline Attribution (same as src/attribution.ts) ─────────────
const tag = keccak256(toBytes('mpp')).slice(0, 10);

function fingerprint(value) {
  const hash = keccak256(toBytes(value));
  return hexToBytes(hash.slice(0, 22));
}

function challengeNonce(challengeId) {
  const hash = keccak256(toBytes(challengeId));
  return hexToBytes(hash.slice(0, 16));
}

function encode({ challengeId, clientId, serverId }) {
  const buf = new Uint8Array(32);
  buf.set(hexToBytes(tag), 0);
  buf[4] = 0x01;
  buf.set(fingerprint(serverId), 5);
  if (clientId) buf.set(fingerprint(clientId), 15);
  buf.set(challengeNonce(challengeId), 25);
  return toHex(buf);
}

function isMppMemo(memo) {
  if (memo.length !== 66) return false;
  return memo.slice(0, 10).toLowerCase() === tag.toLowerCase() && parseInt(memo.slice(10, 12), 16) === 0x01;
}

function verifyChallengeBinding(memo, challengeId) {
  if (!isMppMemo(memo)) return false;
  const nonce = `0x${memo.slice(52)}`;
  const expected = toHex(challengeNonce(challengeId));
  return nonce.toLowerCase() === expected.toLowerCase();
}

function verifyServer(memo, serverId) {
  if (!isMppMemo(memo)) return false;
  const memoServer = `0x${memo.slice(12, 32)}`;
  const expected = toHex(fingerprint(serverId));
  return memoServer.toLowerCase() === expected.toLowerCase();
}

// ─── Mirror Node helpers ─────────────────────────────────────────
function formatTxId(txId) {
  return txId.replace('@', '-').replace(/\.(?=\d+$)/, '-');
}

async function fetchTx(txId, retries = 8) {
  const urlId = formatTxId(txId);
  for (let i = 0; i < retries; i++) {
    const resp = await fetch(`${MIRROR_NODE}/api/v1/transactions/${urlId}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data?.transactions?.length) return data.transactions[0];
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Transaction ${txId} not found after ${retries} retries`);
}

// ─── Test 1: Attribution roundtrip ───────────────────────────────
function testAttribution() {
  console.log('\n═══ TEST 1: Attribution encoding/decoding ═══');

  const challengeId = 'test-challenge-roundtrip';
  const serverId = 'api.example.com';
  const clientId = 'my-agent';

  const memo = encode({ challengeId, serverId, clientId });
  console.log('  memo:', memo);
  console.log('  length:', memo.length, memo.length === 66 ? '✅' : '❌');
  console.log('  isMppMemo:', isMppMemo(memo) ? '✅' : '❌');
  console.log('  verifyServer:', verifyServer(memo, serverId) ? '✅' : '❌');
  console.log('  verifyServer (wrong):', !verifyServer(memo, 'wrong.com') ? '✅' : '❌');
  console.log('  verifyChallengeBinding:', verifyChallengeBinding(memo, challengeId) ? '✅' : '❌');
  console.log('  verifyChallengeBinding (wrong):', !verifyChallengeBinding(memo, 'wrong-id') ? '✅' : '❌');

  return isMppMemo(memo) && verifyServer(memo, serverId) && verifyChallengeBinding(memo, challengeId);
}

// ─── Test 2: Push mode with splits ───────────────────────────────
async function testPushWithSplits() {
  console.log('\n═══ TEST 2: Push mode charge with splits ═══');

  const challengeId = 'split-test-' + Date.now();
  const serverId = 'test-server.hedera-mpp.dev';
  const memo = encode({ challengeId, serverId });

  const client = HederaClient.forTestnet();
  const key = PrivateKey.fromStringECDSA(OPERATOR_KEY);
  client.setOperator(AccountId.fromString(OPERATOR_ID), key);

  // Split: 2 units to escrow (primary), 1 unit to self (split)
  // Total = 3, primary = 2, split = 1
  const totalAmount = 3;
  const primaryAmount = 2;
  const splitAmount = 1;

  const tx = new TransferTransaction();
  const token = TokenId.fromString(USDC_TOKEN_ID);

  // Debit payer for full amount
  tx.addTokenTransfer(token, AccountId.fromString(OPERATOR_ID), -totalAmount);
  // Credit primary recipient
  tx.addTokenTransfer(token, AccountId.fromString(ESCROW_ID), primaryAmount);
  // Credit split recipient (using operator as split recipient for testing)
  tx.addTokenTransfer(token, AccountId.fromString(OPERATOR_ID), splitAmount);

  tx.setTransactionMemo(memo).freezeWith(client);

  console.log('  Submitting split transfer...');
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const txId = response.transactionId.toString();

  console.log('  status:', receipt.status.toString(), receipt.status.toString() === 'SUCCESS' ? '✅' : '❌');
  console.log('  txId:', txId);

  console.log('  Waiting for Mirror Node...');
  await new Promise(r => setTimeout(r, 5000));

  const mirrorTx = await fetchTx(txId);
  console.log('  result:', mirrorTx.result, mirrorTx.result === 'SUCCESS' ? '✅' : '❌');

  // Verify memo
  const decodedMemo = Buffer.from(mirrorTx.memo_base64, 'base64').toString('utf-8');
  console.log('  memo binding:', verifyChallengeBinding(decodedMemo, challengeId) ? '✅' : '❌');

  // Verify transfers
  const transfers = mirrorTx.token_transfers || [];
  console.log('  token_transfers:', JSON.stringify(transfers));

  const escrowCredit = transfers.find(t => t.token_id === USDC_TOKEN_ID && t.account === ESCROW_ID && t.amount > 0);
  console.log('  escrow credit found:', escrowCredit ? '✅' : '❌');

  client.close();
  return receipt.status.toString() === 'SUCCESS' && verifyChallengeBinding(decodedMemo, challengeId) && !!escrowCredit;
}

// ─── Test 3: Pull mode (sign + serialize, then deserialize + submit) ──
async function testPullMode() {
  console.log('\n═══ TEST 3: Pull mode (sign, serialize, deserialize, submit) ═══');

  const challengeId = 'pull-test-' + Date.now();
  const serverId = 'test-server.hedera-mpp.dev';
  const memo = encode({ challengeId, serverId });

  const key = PrivateKey.fromStringECDSA(OPERATOR_KEY);

  // ── CLIENT SIDE: freeze + sign + serialize ──
  console.log('  [Client] Building and signing transaction...');
  const clientHederaClient = HederaClient.forTestnet();
  clientHederaClient.setOperator(AccountId.fromString(OPERATOR_ID), key);

  const tx = new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(USDC_TOKEN_ID), AccountId.fromString(OPERATOR_ID), -1)
    .addTokenTransfer(TokenId.fromString(USDC_TOKEN_ID), AccountId.fromString(ESCROW_ID), 1)
    .setTransactionMemo(memo)
    .freezeWith(clientHederaClient);

  const signed = await tx.sign(key);
  const txBytes = signed.toBytes();
  const base64Tx = Buffer.from(txBytes).toString('base64');

  console.log('  [Client] Serialized tx:', base64Tx.length, 'base64 chars');
  clientHederaClient.close();

  // ── SERVER SIDE: deserialize + verify memo + submit ──
  console.log('  [Server] Deserializing transaction...');
  const deserializedBytes = Buffer.from(base64Tx, 'base64');
  const serverTx = Transaction.fromBytes(deserializedBytes);

  // Verify memo
  const txMemo = serverTx.transactionMemo;
  console.log('  [Server] Memo from deserialized tx:', txMemo);
  console.log('  [Server] isMppMemo:', isMppMemo(txMemo) ? '✅' : '❌');
  console.log('  [Server] verifyServer:', verifyServer(txMemo, serverId) ? '✅' : '❌');
  console.log('  [Server] verifyChallengeBinding:', verifyChallengeBinding(txMemo, challengeId) ? '✅' : '❌');

  // Submit
  console.log('  [Server] Submitting transaction...');
  const serverClient = HederaClient.forTestnet();
  serverClient.setOperator(AccountId.fromString(OPERATOR_ID), key);

  const response = await serverTx.execute(serverClient);
  const receipt = await response.getReceipt(serverClient);
  const txId = response.transactionId.toString();

  console.log('  [Server] status:', receipt.status.toString(), receipt.status.toString() === 'SUCCESS' ? '✅' : '❌');
  console.log('  [Server] txId:', txId);

  // Verify on Mirror Node
  console.log('  Waiting for Mirror Node...');
  await new Promise(r => setTimeout(r, 5000));

  const mirrorTx = await fetchTx(txId);
  const mirrorMemo = Buffer.from(mirrorTx.memo_base64, 'base64').toString('utf-8');
  console.log('  Mirror Node memo matches:', mirrorMemo === txMemo ? '✅' : '❌');

  const transfers = mirrorTx.token_transfers || [];
  const escrowCredit = transfers.find(t => t.token_id === USDC_TOKEN_ID && t.account === ESCROW_ID && t.amount > 0);
  console.log('  escrow credit found:', escrowCredit ? '✅' : '❌');

  serverClient.close();
  return receipt.status.toString() === 'SUCCESS' && isMppMemo(txMemo) && verifyChallengeBinding(txMemo, challengeId);
}

// ─── Run all tests ───────────────────────────────────────────────
async function main() {
  console.log('mppx-hedera v0.2.0 — Feature Tests on Hedera Testnet\n');

  const results = {};

  // Test 1: Attribution roundtrip (no network)
  results['Attribution'] = testAttribution();

  // Test 2: Push mode with splits (network)
  try {
    results['Push + Splits'] = await testPushWithSplits();
  } catch (e) {
    console.log('  ❌ ERROR:', e.message);
    results['Push + Splits'] = false;
  }

  // Test 3: Pull mode (network)
  try {
    results['Pull Mode'] = await testPullMode();
  } catch (e) {
    console.log('  ❌ ERROR:', e.message);
    results['Pull Mode'] = false;
  }

  // Summary
  console.log('\n═══ RESULTS ═══');
  let allPass = true;
  for (const [name, pass] of Object.entries(results)) {
    console.log(`  ${pass ? '✅' : '❌'} ${name}`);
    if (!pass) allPass = false;
  }
  console.log(`\n${allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
}

main().catch(console.error);
