/**
 * Schema validation tests for chargeMethod and sessionMethod.
 *
 * Imports from the BUILT dist/ — run `pnpm build` before executing.
 * Usage:  node test/schema.test.mjs
 */

import assert from 'node:assert/strict';
import { chargeMethod, sessionMethod } from '../dist/index.js';

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
// Helpers
// ---------------------------------------------------------------------------

const chargeReq = chargeMethod.schema.request;
const chargeCred = chargeMethod.schema.credential.payload;
const sessionCred = sessionMethod.schema.credential.payload;

function parsesOk(schema, data) {
  const r = schema.safeParse(data);
  assert.ok(r.success, `Expected parse to succeed: ${JSON.stringify(r.error?.issues ?? r.error)}`);
  return r.data;
}

function parsesFail(schema, data) {
  const r = schema.safeParse(data);
  assert.equal(r.success, false, 'Expected parse to fail but it succeeded');
}

// ---------------------------------------------------------------------------
// chargeMethod.schema.request
// ---------------------------------------------------------------------------

console.log('\nchargeMethod.schema.request');

test('accepts valid input', () => {
  parsesOk(chargeReq, {
    amount: '0.01',
    currency: '0x1549',
    decimals: 6,
    recipient: '0.0.123',
  });
});

test('accepts optional fields (chainId, description, externalId)', () => {
  parsesOk(chargeReq, {
    amount: '1.00',
    currency: '0x1549',
    decimals: 6,
    recipient: '0.0.123',
    chainId: 296,
    description: 'test payment',
    externalId: 'order-42',
  });
});

test('accepts splits array', () => {
  parsesOk(chargeReq, {
    amount: '1.00',
    currency: '0x1549',
    decimals: 6,
    recipient: '0.0.123',
    splits: [
      { recipient: '0.0.456', amount: '0.50' },
      { recipient: '0.0.789', amount: '0.50', memo: 'platform fee' },
    ],
  });
});

test('rejects missing amount', () => {
  parsesFail(chargeReq, {
    currency: '0x1549',
    decimals: 6,
    recipient: '0.0.123',
  });
});

test('rejects missing currency', () => {
  parsesFail(chargeReq, {
    amount: '0.01',
    decimals: 6,
    recipient: '0.0.123',
  });
});

test('rejects missing decimals', () => {
  parsesFail(chargeReq, {
    amount: '0.01',
    currency: '0x1549',
    recipient: '0.0.123',
  });
});

test('rejects missing recipient', () => {
  parsesFail(chargeReq, {
    amount: '0.01',
    currency: '0x1549',
    decimals: 6,
  });
});

test('transforms amount via parseUnits (0.01 with decimals 6 -> "10000")', () => {
  const out = parsesOk(chargeReq, {
    amount: '0.01',
    currency: '0x1549',
    decimals: 6,
    recipient: '0.0.123',
  });
  assert.equal(out.amount, '10000');
});

test('transforms split amounts', () => {
  const out = parsesOk(chargeReq, {
    amount: '1.00',
    currency: '0x1549',
    decimals: 6,
    recipient: '0.0.123',
    splits: [{ recipient: '0.0.456', amount: '0.50' }],
  });
  assert.equal(out.splits[0].amount, '500000');
});

test('passes through externalId', () => {
  const out = parsesOk(chargeReq, {
    amount: '0.01',
    currency: '0x1549',
    decimals: 6,
    recipient: '0.0.123',
    externalId: 'ext-99',
  });
  assert.equal(out.externalId, 'ext-99');
});

// ---------------------------------------------------------------------------
// chargeMethod.schema.credential.payload
// ---------------------------------------------------------------------------

console.log('\nchargeMethod.schema.credential.payload');

test('accepts {type:"hash", transactionId}', () => {
  parsesOk(chargeCred, { type: 'hash', transactionId: '0.0.123@456.789' });
});

test('accepts {type:"transaction", transaction}', () => {
  parsesOk(chargeCred, { type: 'transaction', transaction: 'base64data' });
});

test('rejects unknown type', () => {
  parsesFail(chargeCred, { type: 'unknown', data: 'foo' });
});

test('rejects missing transactionId on hash type', () => {
  parsesFail(chargeCred, { type: 'hash' });
});

test('rejects missing transaction on transaction type', () => {
  parsesFail(chargeCred, { type: 'transaction' });
});

// ---------------------------------------------------------------------------
// sessionMethod.schema.credential.payload
// ---------------------------------------------------------------------------

console.log('\nsessionMethod.schema.credential.payload');

test('accepts {action:"open", ...}', () => {
  parsesOk(sessionCred, {
    action: 'open',
    channelId: '0x' + 'ab'.repeat(32),
    cumulativeAmount: '100',
    signature: '0x' + 'cd'.repeat(65),
    txHash: '0x' + 'ef'.repeat(32),
  });
});

test('accepts {action:"voucher", ...}', () => {
  parsesOk(sessionCred, {
    action: 'voucher',
    channelId: '0x' + 'ab'.repeat(32),
    cumulativeAmount: '200',
    signature: '0x' + 'cd'.repeat(65),
  });
});

test('accepts {action:"close", ...}', () => {
  parsesOk(sessionCred, {
    action: 'close',
    channelId: '0x' + 'ab'.repeat(32),
    cumulativeAmount: '300',
    signature: '0x' + 'cd'.repeat(65),
  });
});

test('accepts {action:"topUp", ...}', () => {
  parsesOk(sessionCred, {
    action: 'topUp',
    channelId: '0x' + 'ab'.repeat(32),
    additionalDeposit: '500',
    txHash: '0x' + 'ef'.repeat(32),
  });
});

test('rejects unknown action', () => {
  parsesFail(sessionCred, {
    action: 'unknown',
    channelId: '0x' + 'ab'.repeat(32),
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
