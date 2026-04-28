/**
 * End-to-end test: native Hedera charge with Attribution memo.
 *
 * Tests:
 * 1. Attribution.encode() produces a valid 32-byte memo
 * 2. TransferTransaction with memo executes on testnet
 * 3. Mirror Node returns the memo in memo_base64
 * 4. Attribution.verifyChallengeBinding() passes
 * 5. Token transfers match expected amount/recipient
 */

import {
  Client as HederaClient,
  TransferTransaction,
  AccountId,
  TokenId,
  PrivateKey,
} from '@hiero-ledger/sdk';

// Import our Attribution module
import { keccak256, toBytes, toHex, hexToBytes } from 'viem';

// ─── Config ──────────────────────────────────────────────────────
const OPERATOR_ID = '0.0.8569027';
const OPERATOR_KEY = '6cabd0b8117cc36b0cb1b90d4a3151722be502cbc1c0efb255c7c3137268b904';
// Use the escrow contract's Hedera account as recipient (it's associated with USDC)
// Contract 0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE on testnet
const RECIPIENT_ID = '0.0.8600318'; // HederaStreamChannel testnet (associated with USDC)
const USDC_TOKEN_ID = '0.0.5449';
const AMOUNT = 1; // 0.000001 USDC (1 tinybar unit)
const MIRROR_NODE = 'https://testnet.mirrornode.hedera.com';

// ─── Inline Attribution (to test without build) ──────────────────
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
  const memoTag = memo.slice(0, 10);
  const memoVersion = parseInt(memo.slice(10, 12), 16);
  return memoTag.toLowerCase() === tag.toLowerCase() && memoVersion === 0x01;
}

function decodeMemo(memo) {
  if (!isMppMemo(memo)) return null;
  return {
    version: parseInt(memo.slice(10, 12), 16),
    serverFingerprint: `0x${memo.slice(12, 32)}`,
    clientFingerprint: `0x${memo.slice(32, 52)}`,
    nonce: `0x${memo.slice(52)}`,
  };
}

function verifyChallengeBinding(memo, challengeId) {
  const decoded = decodeMemo(memo);
  if (!decoded) return false;
  const expectedNonce = toHex(challengeNonce(challengeId));
  return decoded.nonce.toLowerCase() === expectedNonce.toLowerCase();
}

// ─── Test ────────────────────────────────────────────────────────
async function main() {
  const fakeChallengeId = 'test-challenge-' + Date.now();
  const serverId = 'test-server.hedera-mpp.dev';

  console.log('1. Encoding Attribution memo...');
  const memo = encode({ challengeId: fakeChallengeId, serverId });
  console.log('   memo:', memo);
  console.log('   length:', memo.length, '(expected 66)');
  console.log('   isMppMemo:', isMppMemo(memo));
  console.log('   decoded:', decodeMemo(memo));

  console.log('\n2. Submitting TransferTransaction with memo...');
  const client = HederaClient.forTestnet();
  const key = PrivateKey.fromStringECDSA(OPERATOR_KEY);
  client.setOperator(AccountId.fromString(OPERATOR_ID), key);

  const tx = new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(USDC_TOKEN_ID), AccountId.fromString(OPERATOR_ID), -AMOUNT)
    .addTokenTransfer(TokenId.fromString(USDC_TOKEN_ID), AccountId.fromString(RECIPIENT_ID), AMOUNT)
    .setTransactionMemo(memo)
    .freezeWith(client);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const txId = response.transactionId.toString();

  console.log('   status:', receipt.status.toString());
  console.log('   transactionId:', txId);

  // Convert to Mirror Node format
  const mirrorTxId = txId.replace('@', '-').replace(/\.(?=\d+$)/, '-');
  console.log('   mirrorTxId:', mirrorTxId);

  console.log('\n3. Waiting for Mirror Node indexing (5s)...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('4. Fetching from Mirror Node...');
  const url = `${MIRROR_NODE}/api/v1/transactions/${mirrorTxId}`;
  console.log('   url:', url);

  let data;
  for (let i = 0; i < 5; i++) {
    const resp = await fetch(url);
    if (resp.ok) {
      data = await resp.json();
      if (data?.transactions?.length) break;
    }
    console.log('   retry', i + 1);
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!data?.transactions?.length) {
    console.error('   FAILED: transaction not found on Mirror Node');
    process.exit(1);
  }

  const mirrorTx = data.transactions[0];
  console.log('   result:', mirrorTx.result);
  console.log('   memo_base64:', mirrorTx.memo_base64);

  // Decode memo
  const decodedMemo = Buffer.from(mirrorTx.memo_base64, 'base64').toString('utf-8');
  console.log('   decoded memo:', decodedMemo);

  console.log('\n5. Verifying challenge binding...');
  const isValid = verifyChallengeBinding(decodedMemo, fakeChallengeId);
  console.log('   verifyChallengeBinding:', isValid);

  console.log('\n6. Checking token transfers...');
  const transfers = mirrorTx.token_transfers || [];
  console.log('   token_transfers:', JSON.stringify(transfers, null, 2));

  const credit = transfers.find(
    t => t.token_id === USDC_TOKEN_ID && t.account === RECIPIENT_ID && t.amount > 0
  );
  console.log('   matching credit:', credit ? 'FOUND' : 'NOT FOUND');

  console.log('\n═══ RESULT ═══');
  if (isValid && credit) {
    console.log('✅ ALL CHECKS PASSED');
  } else {
    console.log('❌ FAILED');
    if (!isValid) console.log('   - Challenge binding failed');
    if (!credit) console.log('   - No matching token transfer');
  }

  client.close();
}

main().catch(console.error);
