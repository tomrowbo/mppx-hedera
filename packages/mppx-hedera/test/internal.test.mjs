/**
 * Internal utilities tests — 10 tests
 * Imports from the BUILT dist/ chunk (internal helpers not re-exported from index).
 */
import assert from 'node:assert/strict';
import { hederaTestnet, hederaMainnet } from '../dist/index.js';

// Internal helpers are exported from the chunk but not from index.js.
// Import them directly from the chunk file.
import {
  resolveChain,
  resolveMirrorNode,
  formatTxIdForMirrorNode,
  assertUint128,
} from '../dist/chunk-QKV4OT6A.js';

let passed = 0;
let failed = 0;
const total = 10;

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

console.log('Internal utilities');
console.log('==================');

// --- resolveChain ---

test('resolveChain(296) returns chain with id 296', () => {
  const chain = resolveChain(296);
  assert.equal(chain.id, 296);
  assert.equal(chain.name, 'Hedera Testnet');
});

test('resolveChain(295) returns chain with id 295', () => {
  const chain = resolveChain(295);
  assert.equal(chain.id, 295);
  assert.equal(chain.name, 'Hedera Mainnet');
});

test('resolveChain(999) throws', () => {
  assert.throws(() => resolveChain(999), /Unsupported Hedera chainId/);
});

// --- resolveMirrorNode ---

test('resolveMirrorNode(296) returns testnet URL', () => {
  const url = resolveMirrorNode(296);
  assert.equal(url, 'https://testnet.mirrornode.hedera.com');
});

test('resolveMirrorNode(295) returns mainnet URL', () => {
  const url = resolveMirrorNode(295);
  assert.equal(url, 'https://mainnet.mirrornode.hedera.com');
});

test('resolveMirrorNode(999) throws', () => {
  assert.throws(() => resolveMirrorNode(999), /Unsupported Hedera chainId/);
});

// --- formatTxIdForMirrorNode ---

test('formatTxIdForMirrorNode converts correctly', () => {
  const result = formatTxIdForMirrorNode('0.0.12345@1681234567.123456789');
  assert.equal(result, '0.0.12345-1681234567-123456789');
});

// --- assertUint128 ---

test('assertUint128(0n) passes', () => {
  // Should not throw
  assertUint128(0n);
});

test('assertUint128(2n**128n - 1n) passes', () => {
  // Should not throw — maximum uint128 value
  assertUint128(2n ** 128n - 1n);
});

test('assertUint128(-1n) throws', () => {
  assert.throws(() => assertUint128(-1n), /uint128/);
});

// --- Summary ---
console.log(`\n${passed}/${total} passed`);
if (failed > 0) process.exit(1);
