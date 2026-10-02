/**
 * charge-currency.test.ts — verification must settle the token the challenge advertised.
 *
 * Regression cover for two related defects fixed in 0.3.0.
 *
 * 1. `currency` was configurable on `hedera.charge()` and per call, and both verification
 *    paths then ignored it and read `DEFAULT_TOKEN_ID[chainId]` instead. A server could
 *    advertise one token and look for transfers of another — the override was accepted on
 *    the way out and silently dropped on the way back, so a correctly configured server
 *    rejected a correctly paying buyer.
 *
 * 2. The testnet default was `0.0.5449`, which has no faucet. Circle's own testnet USDC —
 *    the one `faucet.circle.com` dispenses — is `0.0.429274`. Both are named "USD Coin"
 *    with symbol USDC and 6 decimals, so the two are indistinguishable in logs and error
 *    messages; only the treasury differs.
 *
 * The first test pins the default. The rest drive `verifyPullMode` with a Mirror Node that
 * only ever reports transfers of a *custom* token, so they fail if verification falls back
 * to any default at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from 'mppx';
import * as Attribution from '../src/attribution.js';
import {
  DEFAULT_TOKEN_ID,
  USDC_TOKEN_ID_MAINNET,
  USDC_TOKEN_ID_TESTNET,
} from '../src/constants.js';

const mockExecute = vi.fn();
const mockGetReceipt = vi.fn();

vi.mock('@hiero-ledger/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hiero-ledger/sdk')>();
  return {
    ...actual,
    Transaction: {
      ...actual.Transaction,
      fromBytes: vi.fn(),
    },
  };
});

const { Transaction } = await import('@hiero-ledger/sdk');
const { charge } = await import('../src/server/charge.js');

const SERVER_ID = 'test-server.example.com';
const RECIPIENT = '0.0.99999';
const CHALLENGE_ID = 'currency-test-challenge-id';
const CHAIN_ID = 296;
const AMOUNT = '1000000';
/** Deliberately neither default, so a fallback to either is a visible failure. */
const CUSTOM_TOKEN = '0.0.111222';
const VALID_MEMO = Attribution.encode({ challengeId: CHALLENGE_ID, serverId: SERVER_ID });

function mirrorNodeWith(tokenId: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      transactions: [
        {
          result: 'SUCCESS',
          token_transfers: [{ token_id: tokenId, account: RECIPIENT, amount: Number(AMOUNT) }],
          memo_base64: '',
        },
      ],
    }),
  };
}

function pullCredential(currency?: string) {
  return {
    payload: {
      type: 'transaction' as const,
      transaction: Buffer.from('fake-transaction-bytes').toString('base64'),
    },
    challenge: {
      id: CHALLENGE_ID,
      request: {
        amount: AMOUNT,
        recipient: RECIPIENT,
        chainId: CHAIN_ID,
        ...(currency ? { currency } : {}),
      },
    },
  };
}

function handlerFor(currency?: string) {
  return charge({
    serverId: SERVER_ID,
    recipient: RECIPIENT,
    testnet: true,
    store: Store.memory(),
    operatorId: '0.0.12345',
    operatorKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
    ...(currency ? { currency } : {}),
  }) as any;
}

describe('testnet default token', () => {
  it("is Circle's USDC, the one their faucet dispenses", () => {
    expect(USDC_TOKEN_ID_TESTNET).toBe('0.0.429274');
    expect(DEFAULT_TOKEN_ID[296]).toBe('0.0.429274');
  });

  it("keeps Circle's mainnet USDC unchanged", () => {
    expect(USDC_TOKEN_ID_MAINNET).toBe('0.0.456858');
    expect(DEFAULT_TOKEN_ID[295]).toBe('0.0.456858');
  });
});

describe('pull-mode verification honours the challenge currency', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    vi.mocked(Transaction.fromBytes).mockReturnValue({
      transactionMemo: VALID_MEMO,
      execute: mockExecute,
      toBytes: () => new Uint8Array([1, 2, 3]),
    } as any);
    mockExecute.mockResolvedValue({
      transactionId: { toString: () => '0.0.12345@1681234567.123456789' },
      getReceipt: mockGetReceipt,
    });
    mockGetReceipt.mockResolvedValue({ status: { toString: () => 'SUCCESS' } });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('accepts a transfer of the per-charge currency', async () => {
    // The ledger only ever shows CUSTOM_TOKEN. Before the fix this looked up
    // DEFAULT_TOKEN_ID[296], found no matching transfer, and refused the payment.
    globalThis.fetch = vi.fn().mockResolvedValue(mirrorNodeWith(CUSTOM_TOKEN));
    const result = await handlerFor().verify({ credential: pullCredential(CUSTOM_TOKEN) });
    expect(result.status).toBe('success');
  });

  it('accepts a transfer of a currency configured at construction time', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mirrorNodeWith(CUSTOM_TOKEN));
    const result = await handlerFor(CUSTOM_TOKEN).verify({
      credential: pullCredential(CUSTOM_TOKEN),
    });
    expect(result.status).toBe('success');
  });

  it('still rejects a transfer of a different token than the one advertised', async () => {
    // The guard this fix must not weaken: paying the default when the challenge asked for
    // something else is not a payment of that challenge.
    globalThis.fetch = vi.fn().mockResolvedValue(mirrorNodeWith(USDC_TOKEN_ID_TESTNET));
    await expect(
      handlerFor().verify({ credential: pullCredential(CUSTOM_TOKEN) }),
    ).rejects.toThrow();
  });

  it('falls back to the network default when the challenge names no currency', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mirrorNodeWith(USDC_TOKEN_ID_TESTNET));
    const result = await handlerFor().verify({ credential: pullCredential() });
    expect(result.status).toBe('success');
  });
});
