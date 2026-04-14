/**
 * mppx-integration.test.ts — Full HTTP round-trip integration tests.
 *
 * Tests the complete mppx middleware stack:
 *   Mppx.create() -> Request -> 402 challenge -> credential -> verify -> 200 + receipt
 *
 * Mocks globalThis.fetch for Mirror Node calls to avoid network traffic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mppx } from 'mppx/server';
import { Challenge, Credential, Receipt } from 'mppx';
import { hedera } from '../src/server/index.js';
import * as Attribution from '../src/attribution.js';

// ─── Test constants ─────────────────────────────────────────────────

const SERVER_ID = 'test-server.example.com';
const RECIPIENT = '0.0.99999';
const SECRET_KEY = 'test-secret-key-32-chars-minimum!!';
const REALM = 'test-server.example.com';
const TX_ID = '0.0.12345@1234567890.123456789';
const TOKEN_ID = '0.0.5449'; // testnet USDC
const AMOUNT = '0.01'; // human-readable, schema transforms to smallest unit
const AMOUNT_RAW = '10000'; // 0.01 * 10^6 = 10000 (USDC has 6 decimals)
const RESOURCE_URL = 'https://test-server.example.com/api/resource';

// ─── Helpers ────────────────────────────────────────────────────────

function createServer() {
  const mppx = Mppx.create({
    methods: [
      hedera.charge({
        serverId: SERVER_ID,
        recipient: RECIPIENT,
        testnet: true,
        maxRetries: 0,
        retryDelay: 10,
      }),
    ],
    realm: REALM,
    secretKey: SECRET_KEY,
  });

  // The handler accepts a Request and returns {status, challenge?, withReceipt?}
  const handler = (mppx as any).charge({
    amount: AMOUNT,
    currency: TOKEN_ID,
    decimals: 6,
    recipient: RECIPIENT,
    expires: new Date(Date.now() + 300_000).toISOString(),
  });

  return { mppx, handler };
}

function createExpiredServer() {
  const mppx = Mppx.create({
    methods: [
      hedera.charge({
        serverId: SERVER_ID,
        recipient: RECIPIENT,
        testnet: true,
        maxRetries: 0,
        retryDelay: 10,
      }),
    ],
    realm: REALM,
    secretKey: SECRET_KEY,
  });

  // Expired 10 seconds ago
  const handler = (mppx as any).charge({
    amount: AMOUNT,
    currency: TOKEN_ID,
    decimals: 6,
    recipient: RECIPIENT,
    expires: new Date(Date.now() - 10_000).toISOString(),
  });

  return { mppx, handler };
}

function mockMirrorNodeSuccess(memo: string, amount: number = 10000) {
  const memo_base64 = Buffer.from(memo).toString('base64');
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      transactions: [
        {
          result: 'SUCCESS',
          memo_base64,
          token_transfers: [
            { token_id: TOKEN_ID, account: RECIPIENT, amount },
            { token_id: TOKEN_ID, account: '0.0.12345', amount: -amount },
          ],
        },
      ],
    }),
  });
}

function mockMirrorNode404() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({ _status: { messages: [{ message: 'Not found' }] } }),
  });
}

// ─── Test suite ─────────────────────────────────────────────────────

describe('mppx server HTTP round-trip', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('GET /resource returns 402 with WWW-Authenticate header containing method=hedera, intent=charge', async () => {
    const { handler } = createServer();
    const request = new Request(RESOURCE_URL);

    const result = await handler(request);

    expect(result.status).toBe(402);
    const wwwAuth = result.challenge.headers.get('WWW-Authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toContain('Payment');

    // Parse the challenge to verify method and intent
    const challenge = Challenge.fromResponse(result.challenge);
    expect(challenge.method).toBe('hedera');
    expect(challenge.intent).toBe('charge');
  });

  it('WWW-Authenticate challenge contains correct amount, currency, recipient from server defaults', async () => {
    const { handler } = createServer();
    const request = new Request(RESOURCE_URL);

    const result = await handler(request);
    expect(result.status).toBe(402);

    const challenge = Challenge.fromResponse(result.challenge);
    expect(challenge.request.amount).toBe(AMOUNT_RAW);
    expect(challenge.request.currency).toBe(TOKEN_ID);
    expect(challenge.request.recipient).toBe(RECIPIENT);
    expect(challenge.realm).toBe(REALM);
  });

  it('GET with valid Authorization: Payment credential returns 200', async () => {
    const { handler } = createServer();

    // Step 1: Get the 402 challenge
    const challengeResult = await handler(new Request(RESOURCE_URL));
    expect(challengeResult.status).toBe(402);
    const challenge = Challenge.fromResponse(challengeResult.challenge);

    // Step 2: Build a valid memo bound to this challenge
    const memo = Attribution.encode({
      challengeId: challenge.id,
      serverId: SERVER_ID,
    });

    // Step 3: Mock Mirror Node to return a successful transaction
    globalThis.fetch = mockMirrorNodeSuccess(memo);

    // Step 4: Build credential and send authorized request
    const credential = Credential.from({
      challenge,
      payload: { type: 'hash' as const, transactionId: TX_ID },
    });

    const authedRequest = new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(credential) },
    });

    const result = await handler(authedRequest);
    expect(result.status).toBe(200);
  });

  it('Response includes Payment-Receipt header', async () => {
    const { handler } = createServer();

    // Get challenge
    const challengeResult = await handler(new Request(RESOURCE_URL));
    const challenge = Challenge.fromResponse(challengeResult.challenge);

    // Build valid credential
    const memo = Attribution.encode({
      challengeId: challenge.id,
      serverId: SERVER_ID,
    });
    globalThis.fetch = mockMirrorNodeSuccess(memo);

    const credential = Credential.from({
      challenge,
      payload: { type: 'hash' as const, transactionId: TX_ID },
    });

    const authedRequest = new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(credential) },
    });

    const result = await handler(authedRequest);
    expect(result.status).toBe(200);

    // Wrap with receipt and check the Payment-Receipt header
    const response = result.withReceipt(new Response('OK'));
    const receiptHeader = response.headers.get('Payment-Receipt');
    expect(receiptHeader).toBeTruthy();
  });

  it('Payment-Receipt header contains method=hedera, status=success', async () => {
    const { handler } = createServer();

    // Get challenge
    const challengeResult = await handler(new Request(RESOURCE_URL));
    const challenge = Challenge.fromResponse(challengeResult.challenge);

    // Build valid credential
    const memo = Attribution.encode({
      challengeId: challenge.id,
      serverId: SERVER_ID,
    });
    globalThis.fetch = mockMirrorNodeSuccess(memo);

    const credential = Credential.from({
      challenge,
      payload: { type: 'hash' as const, transactionId: TX_ID },
    });

    const authedRequest = new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(credential) },
    });

    const result = await handler(authedRequest);
    expect(result.status).toBe(200);

    const response = result.withReceipt(new Response('OK'));
    const receipt = Receipt.fromResponse(response);
    expect(receipt.method).toBe('hedera');
    expect(receipt.status).toBe('success');
  });

  it('Replayed credential returns 402 (new challenge, not cached 200)', async () => {
    const { handler } = createServer();

    // Get challenge
    const challengeResult = await handler(new Request(RESOURCE_URL));
    const challenge = Challenge.fromResponse(challengeResult.challenge);

    // Build valid credential
    const memo = Attribution.encode({
      challengeId: challenge.id,
      serverId: SERVER_ID,
    });
    globalThis.fetch = mockMirrorNodeSuccess(memo);

    const credential = Credential.from({
      challenge,
      payload: { type: 'hash' as const, transactionId: TX_ID },
    });

    const serialized = Credential.serialize(credential);

    // First request succeeds
    const firstResult = await handler(
      new Request(RESOURCE_URL, { headers: { Authorization: serialized } }),
    );
    expect(firstResult.status).toBe(200);

    // Second request with same credential should fail because the tx ID was
    // already consumed by the idempotency store
    const secondResult = await handler(
      new Request(RESOURCE_URL, { headers: { Authorization: serialized } }),
    );
    expect(secondResult.status).toBe(402);
  });

  it('Expired challenge is rejected', async () => {
    // Create a handler that generates already-expired challenges
    const { handler: expiredHandler } = createExpiredServer();

    // Get the expired challenge
    const challengeResult = await expiredHandler(new Request(RESOURCE_URL));
    expect(challengeResult.status).toBe(402);
    const challenge = Challenge.fromResponse(challengeResult.challenge);

    // Build a credential using the expired challenge
    const memo = Attribution.encode({
      challengeId: challenge.id,
      serverId: SERVER_ID,
    });
    globalThis.fetch = mockMirrorNodeSuccess(memo);

    const credential = Credential.from({
      challenge,
      payload: { type: 'hash' as const, transactionId: TX_ID },
    });

    // Use the fresh handler (which generates non-expired challenges) to verify
    // that the expired credential is rejected
    const { handler: freshHandler } = createServer();
    const result = await freshHandler(
      new Request(RESOURCE_URL, {
        headers: { Authorization: Credential.serialize(credential) },
      }),
    );

    // The server should reject the expired challenge with 402
    expect(result.status).toBe(402);
  });

  it('Malformed credential returns 402', async () => {
    const { handler } = createServer();

    // Send a request with a malformed Authorization header
    const result = await handler(
      new Request(RESOURCE_URL, {
        headers: { Authorization: 'Payment not-valid-base64-json' },
      }),
    );

    expect(result.status).toBe(402);

    // The response should still contain a valid WWW-Authenticate header
    // so the client can retry
    const wwwAuth = result.challenge.headers.get('WWW-Authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toContain('Payment');
  });
});
