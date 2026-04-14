/**
 * Constants module tests — 8 tests
 * Imports from the BUILT dist/ (not source).
 */
import assert from 'node:assert/strict';
import {
  USDC_TESTNET,
  USDC_MAINNET,
  DEFAULT_CURRENCY,
  DEFAULT_ESCROW,
  hederaTestnet,
  hederaMainnet,
} from '../dist/index.js';

// USDC_TOKEN_ID constants and DEFAULT_TOKEN_ID are not re-exported from
// index.js but are available in the chunk.
import {
  DEFAULT_TOKEN_ID,
} from '../dist/chunk-QKV4OT6A.js';

let passed = 0;
let failed = 0;
const total = 8;

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

console.log('Constants module');
console.log('================');

// --- USDC addresses ---

test('USDC_TESTNET starts with 0x and is 42 chars', () => {
  assert.ok(USDC_TESTNET.startsWith('0x'));
  assert.equal(USDC_TESTNET.length, 42);
});

test('USDC_MAINNET starts with 0x and is 42 chars', () => {
  assert.ok(USDC_MAINNET.startsWith('0x'));
  assert.equal(USDC_MAINNET.length, 42);
});

// --- USDC token IDs ---

test('USDC_TOKEN_ID_TESTNET is "0.0.5449"', () => {
  assert.equal(DEFAULT_TOKEN_ID[296], '0.0.5449');
});

test('USDC_TOKEN_ID_MAINNET is "0.0.456858"', () => {
  assert.equal(DEFAULT_TOKEN_ID[295], '0.0.456858');
});

// --- DEFAULT_CURRENCY ---

test('DEFAULT_CURRENCY[296] equals USDC_TESTNET', () => {
  assert.equal(DEFAULT_CURRENCY[296], USDC_TESTNET);
});

test('DEFAULT_CURRENCY[295] equals USDC_MAINNET', () => {
  assert.equal(DEFAULT_CURRENCY[295], USDC_MAINNET);
});

// --- DEFAULT_ESCROW ---

test('DEFAULT_ESCROW[296] is a valid hex address', () => {
  const addr = DEFAULT_ESCROW[296];
  assert.ok(addr.startsWith('0x'), 'should start with 0x');
  assert.equal(addr.length, 42, 'should be 42 characters');
  assert.match(addr, /^0x[0-9a-fA-F]{40}$/, 'should be valid hex');
});

test('DEFAULT_ESCROW[295] is a valid hex address', () => {
  const addr = DEFAULT_ESCROW[295];
  assert.ok(addr.startsWith('0x'), 'should start with 0x');
  assert.equal(addr.length, 42, 'should be 42 characters');
  assert.match(addr, /^0x[0-9a-fA-F]{40}$/, 'should be valid hex');
});

// --- Summary ---
console.log(`\n${passed}/${total} passed`);
if (failed > 0) process.exit(1);
