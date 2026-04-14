/**
 * Attribution module tests — 18 tests
 * Imports from the BUILT dist/ (not source).
 */
import assert from 'node:assert/strict';
import { Attribution } from '../dist/index.js';
import { keccak256, toBytes, toHex, hexToBytes } from 'viem';

let passed = 0;
let failed = 0;
const total = 18;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

console.log('Attribution module');
console.log('==================');

const params = { serverId: 'api.example.com', clientId: 'user-42', challengeId: 'ch_abc' };
const memo = Attribution.encode(params);

// --- encode() tests ---

test('encode() returns 66-char hex string', () => {
  assert.equal(typeof memo, 'string');
  assert.equal(memo.length, 66); // "0x" + 64 hex chars = 32 bytes
});

test('encode() starts with MPP tag + version 0x01', () => {
  const expectedTag = keccak256(toBytes('mpp')).slice(0, 10); // "0x" + 8 hex = 4 bytes
  const memoTag = memo.slice(0, 10);
  assert.equal(memoTag.toLowerCase(), expectedTag.toLowerCase());
  const versionByte = memo.slice(10, 12);
  assert.equal(versionByte, '01');
});

test('encode() server fingerprint at bytes 5-14 matches keccak256(serverId)[0..10]', () => {
  const serverHash = keccak256(toBytes('api.example.com'));
  const expectedHex = serverHash.slice(2, 22); // 20 hex chars = 10 bytes
  const memoServerHex = memo.slice(12, 32);    // offset 5 in bytes = chars 10+2..10+2+20
  assert.equal(memoServerHex.toLowerCase(), expectedHex.toLowerCase());
});

test('encode() client fingerprint at bytes 15-24 when clientId provided', () => {
  const clientHash = keccak256(toBytes('user-42'));
  const expectedHex = clientHash.slice(2, 22);
  const memoClientHex = memo.slice(32, 52); // offset 15 in bytes = chars 30+2..30+2+20
  assert.equal(memoClientHex.toLowerCase(), expectedHex.toLowerCase());
});

test('encode() anonymous client has zero bytes at 15-24', () => {
  const anonMemo = Attribution.encode({ serverId: 'api.example.com', challengeId: 'ch_abc' });
  const clientHex = anonMemo.slice(32, 52);
  assert.equal(clientHex, '00000000000000000000');
});

test('encode() challenge nonce at bytes 25-31', () => {
  const challengeHash = keccak256(toBytes('ch_abc'));
  const expectedHex = challengeHash.slice(2, 16); // 14 hex chars = 7 bytes
  const memoNonceHex = memo.slice(52, 66);        // offset 25 in bytes = chars 50+2..50+2+14
  assert.equal(memoNonceHex.toLowerCase(), expectedHex.toLowerCase());
});

test('encode() deterministic (same inputs = same output)', () => {
  const memo2 = Attribution.encode(params);
  assert.equal(memo, memo2);
});

test('encode() different challengeIds produce different nonces', () => {
  const memo2 = Attribution.encode({ ...params, challengeId: 'ch_xyz' });
  assert.notEqual(memo.slice(52), memo2.slice(52));
});

// --- isMppMemo() tests ---

test('isMppMemo() true for valid memo', () => {
  assert.equal(Attribution.isMppMemo(memo), true);
});

test('isMppMemo() false for zero-filled 32 bytes', () => {
  const zeros = ('0x' + '0'.repeat(64));
  assert.equal(Attribution.isMppMemo(zeros), false);
});

test('isMppMemo() false for arbitrary hex', () => {
  const arb = '0x' + 'ab'.repeat(32);
  assert.equal(Attribution.isMppMemo(arb), false);
});

test('isMppMemo() false for short string', () => {
  assert.equal(Attribution.isMppMemo('0x1234'), false);
});

test('isMppMemo() false for wrong version byte', () => {
  // Replace version byte (chars 10-11) with 0x02
  const bad = memo.slice(0, 10) + '02' + memo.slice(12);
  assert.equal(Attribution.isMppMemo(bad), false);
});

test('isMppMemo() handles mixed case', () => {
  const upper = memo.slice(0, 2) + memo.slice(2).toUpperCase();
  assert.equal(Attribution.isMppMemo(upper), true);
});

// --- verifyServer() tests ---

test('verifyServer() true for matching serverId', () => {
  assert.equal(Attribution.verifyServer(memo, 'api.example.com'), true);
});

test('verifyServer() false for wrong serverId', () => {
  assert.equal(Attribution.verifyServer(memo, 'wrong.server.com'), false);
});

// --- verifyChallengeBinding() tests ---

test('verifyChallengeBinding() true for matching challengeId', () => {
  assert.equal(Attribution.verifyChallengeBinding(memo, 'ch_abc'), true);
});

test('verifyChallengeBinding() false for wrong challengeId', () => {
  assert.equal(Attribution.verifyChallengeBinding(memo, 'ch_wrong'), false);
});

// --- Summary ---
console.log(`\n${passed}/${total} passed`);
if (failed > 0) process.exit(1);
