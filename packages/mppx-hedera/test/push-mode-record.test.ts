/**
 * push-mode verification must read the transfer, not a sibling record.
 *
 * Regression cover for a defect that cost a real testnet payment: the Mirror Node returns
 * every record sharing a transaction id, and a transfer that auto-associates the token on the
 * receiving account emits a `CRYPTOUPDATEACCOUNT` alongside it — returned *first*. Reading
 * `transactions[0]` therefore saw an empty memo and no transfers, and the server rejected a
 * charge the ledger had settled, debiting the buyer and answering 402.
 *
 * The ordering asserted below is the ordering testnet actually returned for
 * `0.0.10840972-1791025766-526007174`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from 'mppx';
import * as Attribution from '../src/attribution.js';
import { USDC_TOKEN_ID_TESTNET } from '../src/constants.js';

const SERVER_ID = 'test-server.example.com';
const RECIPIENT = '0.0.99999';
const PAYER = '0.0.10840972';
const CHALLENGE_ID = 'push-mode-challenge-id';
const AMOUNT = '500000';
const TRANSACTION_ID = `${PAYER}@1791025766.526007174`;
const VALID_MEMO = Attribution.encode({ challengeId: CHALLENGE_ID, serverId: SERVER_ID });

const { charge } = await import('../src/server/charge.js');

/** The auto-association sibling comes first, exactly as the Mirror Node orders it. */
function mirrorNodeWithAssociationSiblingFirst() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      transactions: [
        {
          name: 'CRYPTOUPDATEACCOUNT',
          result: 'SUCCESS',
          memo_base64: '',
          token_transfers: [],
        },
        {
          name: 'CRYPTOTRANSFER',
          result: 'SUCCESS',
          memo_base64: Buffer.from(VALID_MEMO, 'utf-8').toString('base64'),
          token_transfers: [
            { token_id: USDC_TOKEN_ID_TESTNET, account: RECIPIENT, amount: Number(AMOUNT) },
            { token_id: USDC_TOKEN_ID_TESTNET, account: PAYER, amount: -Number(AMOUNT) },
          ],
        },
      ],
    }),
  };
}

function pushCredential() {
  return {
    payload: { type: 'hash' as const, transactionId: TRANSACTION_ID },
    challenge: {
      id: CHALLENGE_ID,
      request: { amount: AMOUNT, recipient: RECIPIENT, chainId: 296, currency: USDC_TOKEN_ID_TESTNET },
    },
  };
}

function handler() {
  return charge({
    serverId: SERVER_ID,
    recipient: RECIPIENT,
    testnet: true,
    store: Store.memory(),
    operatorId: '0.0.12345',
    operatorKey: '302e020100300506032b657004220420' + 'a'.repeat(64),
  }) as any;
}

describe('push-mode record selection', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('verifies the transfer even when an auto-association record is returned first', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mirrorNodeWithAssociationSiblingFirst());
    const result = await handler().verify({ credential: pushCredential() });
    expect(result.status).toBe('success');
  });

  it('still verifies when the transfer is the only record', async () => {
    const { json } = mirrorNodeWithAssociationSiblingFirst();
    const only = (await json()).transactions[1];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transactions: [only] }),
    });
    const result = await handler().verify({ credential: pushCredential() });
    expect(result.status).toBe('success');
  });
});
