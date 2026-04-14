/**
 * Barrel-export verification tests for mppx-hedera.
 *
 * Imports from the BUILT dist/ — run `pnpm build` before executing.
 * Usage:  node test/exports.test.mjs
 */

import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Root index: ../dist/index.js
// ---------------------------------------------------------------------------

const root = await import('../dist/index.js');

console.log('\nRoot exports (dist/index.js)');

test('exports chargeMethod', () => {
  assert.ok(root.chargeMethod, 'chargeMethod is exported');
  assert.equal(typeof root.chargeMethod.schema, 'object');
});

test('exports sessionMethod', () => {
  assert.ok(root.sessionMethod, 'sessionMethod is exported');
  assert.equal(typeof root.sessionMethod.schema, 'object');
});

test('exports Attribution namespace with encode/decode', () => {
  assert.ok(root.Attribution, 'Attribution is exported');
  assert.equal(typeof root.Attribution.encode, 'function', 'Attribution.encode is a function');
  assert.equal(typeof root.Attribution.decode, 'function', 'Attribution.decode is a function');
});

test('exports hederaTestnet with id === 296', () => {
  assert.ok(root.hederaTestnet, 'hederaTestnet is exported');
  assert.equal(root.hederaTestnet.id, 296);
});

test('exports hederaMainnet with id === 295', () => {
  assert.ok(root.hederaMainnet, 'hederaMainnet is exported');
  assert.equal(root.hederaMainnet.id, 295);
});

test('exports USDC_TESTNET', () => {
  assert.ok(typeof root.USDC_TESTNET === 'string', 'USDC_TESTNET is a string');
});

test('exports USDC_MAINNET', () => {
  assert.ok(typeof root.USDC_MAINNET === 'string', 'USDC_MAINNET is a string');
});

test('exports DEFAULT_CURRENCY and DEFAULT_ESCROW', () => {
  assert.ok(root.DEFAULT_CURRENCY !== undefined, 'DEFAULT_CURRENCY is exported');
  assert.ok(root.DEFAULT_ESCROW !== undefined, 'DEFAULT_ESCROW is exported');
});

// ---------------------------------------------------------------------------
// Client index: ../dist/client/index.js
// ---------------------------------------------------------------------------

const client = await import('../dist/client/index.js');

console.log('\nClient exports (dist/client/index.js)');

test('exports charge function', () => {
  assert.equal(typeof client.charge, 'function', 'charge is a function');
});

test('exports hederaCharge alias (same as charge)', () => {
  assert.equal(typeof client.hederaCharge, 'function', 'hederaCharge is a function');
  assert.equal(client.hederaCharge, client.charge, 'hederaCharge === charge');
});

test('exports hederaSession function', () => {
  assert.equal(typeof client.hederaSession, 'function', 'hederaSession is a function');
});

// ---------------------------------------------------------------------------
// Server index: ../dist/server/index.js
// ---------------------------------------------------------------------------

const server = await import('../dist/server/index.js');

console.log('\nServer exports (dist/server/index.js)');

test('exports hedera namespace with charge and session', () => {
  assert.ok(server.hedera, 'hedera namespace is exported');
  assert.equal(typeof server.hedera.charge, 'function', 'hedera.charge is a function');
  assert.equal(typeof server.hedera.session, 'function', 'hedera.session is a function');
});

test('exports Sse namespace with serve, toResponse, parseEvent', () => {
  assert.ok(server.Sse, 'Sse namespace is exported');
  assert.equal(typeof server.Sse.serve, 'function', 'Sse.serve is a function');
  assert.equal(typeof server.Sse.toResponse, 'function', 'Sse.toResponse is a function');
  assert.equal(typeof server.Sse.parseEvent, 'function', 'Sse.parseEvent is a function');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
