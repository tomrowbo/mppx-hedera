/**
 * charge-defaults.test.ts — construction-time config must reach the challenge.
 *
 * Regression cover for the gap that let mppx-hedera 0.2.2 ship broken against
 * mppx 0.10: `charge()` supplied `recipient`/`currency`/`chainId` only from its
 * `request()` hook, which mppx runs AFTER schema validation. Configuring them on
 * `hedera.charge({ ... })` — the documented usage — was therefore rejected with a
 * ZodError before the hook could fill them in.
 *
 * Every other test in this suite passes `recipient` to BOTH `hedera.charge()` and
 * the `mppx.charge()` call, so none of them exercised construction-time config and
 * the break was invisible. These tests deliberately omit it at the call site.
 */

import { describe, it, expect } from 'vitest';
import { Mppx } from 'mppx/server';
import { hedera } from '../src/server/index.js';
import { USDC_TOKEN_ID_TESTNET } from '../src/constants.js';

const SERVER_ID = 'test-server.example.com';
const RECIPIENT = '0.0.99999';
const SECRET_KEY = 'test-secret-key-32-chars-minimum!!';
const RESOURCE_URL = 'https://test-server.example.com/api/resource';

/** Decodes the base64url `request` auth-param out of a 402's WWW-Authenticate. */
function decodeChallengeRequest(response: Response): Record<string, unknown> {
  const header = response.headers.get('WWW-Authenticate');
  expect(header).toBeTruthy();
  const match = header!.match(/request="([^"]+)"/);
  expect(match).toBeTruthy();
  return JSON.parse(Buffer.from(match![1], 'base64url').toString('utf8'));
}

describe('charge() construction-time defaults', () => {
  it('uses recipient and currency configured on hedera.charge() alone', async () => {
    const mppx = Mppx.create({
      methods: [
        hedera.charge({
          serverId: SERVER_ID,
          recipient: RECIPIENT,
          testnet: true,
        }),
      ],
      realm: SERVER_ID,
      secretKey: SECRET_KEY,
    });

    // Deliberately no recipient and no currency here — that is the whole point.
    const result = await (mppx as any).charge({ amount: '0.01', decimals: 6 })(
      new Request(RESOURCE_URL),
    );

    expect(result.status).toBe(402);

    const request = decodeChallengeRequest(result.challenge);
    expect(request.recipient).toBe(RECIPIENT);
    expect(request.currency).toBe(USDC_TOKEN_ID_TESTNET);
    expect(request.amount).toBe('10000');
    expect((request.methodDetails as Record<string, unknown>).chainId).toBe(296);
  });

  it('lets a per-charge recipient override the configured one', async () => {
    const mppx = Mppx.create({
      methods: [
        hedera.charge({
          serverId: SERVER_ID,
          recipient: RECIPIENT,
          testnet: true,
        }),
      ],
      realm: SERVER_ID,
      secretKey: SECRET_KEY,
    });

    const override = '0.0.12345';
    const result = await (mppx as any).charge({
      amount: '0.01',
      decimals: 6,
      recipient: override,
    })(new Request(RESOURCE_URL));

    expect(result.status).toBe(402);
    expect(decodeChallengeRequest(result.challenge).recipient).toBe(override);
  });

  it('defaults chainId to mainnet when testnet is not set', async () => {
    const mppx = Mppx.create({
      methods: [
        hedera.charge({
          serverId: SERVER_ID,
          recipient: RECIPIENT,
        }),
      ],
      realm: SERVER_ID,
      secretKey: SECRET_KEY,
    });

    const result = await (mppx as any).charge({ amount: '0.01', decimals: 6 })(
      new Request(RESOURCE_URL),
    );

    expect(result.status).toBe(402);
    const request = decodeChallengeRequest(result.challenge);
    expect((request.methodDetails as Record<string, unknown>).chainId).toBe(295);
  });
});
