/**
 * mppx session integration test — session intent through the real mppx HTTP stack.
 *
 * Tests: Mppx.create() with hedera.session() → 402 challenge → open credential
 * → voucher credential → close credential. Uses DI (getClients) to mock chain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mppx } from 'mppx/server';
import { Challenge, Credential } from 'mppx';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { zeroAddress } from 'viem';
import { session } from '../src/server/session.js';

// ── Constants ────────────────────────────────────────────────────
const SERVER_KEY = generatePrivateKey();
const SERVER_ACCOUNT = privateKeyToAccount(SERVER_KEY);
const RECIPIENT = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const PAYER = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const TOKEN = '0x0000000000000000000000000000000000001549' as `0x${string}`;
const ESCROW = '0x401b6dc30221823361E4876f5C502e37249D84C3' as `0x${string}`;
const CHANNEL_ID = '0x000000000000000000000000000000000000000000000000000000000000abcd' as `0x${string}`;
const SECRET_KEY = 'session-test-secret-key-32-chars-min!!';
const REALM = 'session-test.hedera-mpp.dev';
const RESOURCE_URL = 'https://session-test.hedera-mpp.dev/api/stream';

// ── Mock clients ─────────────────────────────────────────────────
function createMocks() {
  return {
    publicClient: {
      readContract: vi.fn(),
      verifyTypedData: vi.fn().mockResolvedValue(true),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    },
    walletClient: {
      writeContract: vi.fn().mockResolvedValue('0xclosetxhash'),
      account: SERVER_ACCOUNT,
    },
  };
}

function onChainChannel(overrides: Record<string, unknown> = {}) {
  return {
    finalized: false,
    closeRequestedAt: 0n,
    payer: PAYER,
    payee: RECIPIENT,
    token: TOKEN,
    authorizedSigner: zeroAddress,
    deposit: 1000000n,
    settled: 0n,
    ...overrides,
  };
}

describe('mppx session HTTP round-trip', () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    // Default: readContract returns a valid funded channel
    mocks.publicClient.readContract.mockResolvedValue(onChainChannel());
  });

  function createServer() {
    const sessionHandler = session({
      account: SERVER_ACCOUNT,
      recipient: RECIPIENT,
      escrowContract: ESCROW,
      currency: TOKEN,
      amount: '0.001',
      suggestedDeposit: '1',
      decimals: 6,
      testnet: true,
      getClients: () => mocks as any,
    });

    const mppx = Mppx.create({
      methods: [sessionHandler],
      realm: REALM,
      secretKey: SECRET_KEY,
    });

    const route = mppx.session({
      amount: '0.001',
      currency: TOKEN,
      decimals: 6,
      unitType: 'request',
      recipient: RECIPIENT,
      suggestedDeposit: '1',
      escrowContract: ESCROW,
    });

    return { mppx, route };
  }

  it('GET /stream returns 402 with method=hedera, intent=session', async () => {
    const { route } = createServer();
    const result = await route(new Request(RESOURCE_URL));

    expect(result.status).toBe(402);
    const challenge = Challenge.fromResponse(result.challenge);
    expect(challenge.method).toBe('hedera');
    expect(challenge.intent).toBe('session');
  });

  it('session challenge contains escrowContract and suggestedDeposit', async () => {
    const { route } = createServer();
    const result = await route(new Request(RESOURCE_URL));
    const challenge = Challenge.fromResponse(result.challenge);

    expect(challenge.request.methodDetails?.escrowContract).toBe(ESCROW);
    expect(challenge.request.suggestedDeposit).toBeDefined();
  });

  it('open credential returns 200 with session receipt', async () => {
    const { route } = createServer();

    // Step 1: Get challenge
    const challengeResult = await route(new Request(RESOURCE_URL));
    const challenge = Challenge.fromResponse(challengeResult.challenge);

    // Step 2: Build open credential
    const credential = Credential.from({
      challenge,
      payload: {
        action: 'open' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: String(BigInt(challenge.request.amount)),
        signature: `0x${'ff'.repeat(65)}`,
        txHash: `0x${'aa'.repeat(32)}`,
      },
    });

    const serialized = Credential.serialize(credential);

    // Step 3: Send authorized request
    const authedRequest = new Request(RESOURCE_URL, {
      headers: { Authorization: serialized },
    });
    const result = await route(authedRequest);

    expect(result.status).toBe(200);
  });

  it('voucher credential accepted after open', async () => {
    const { route } = createServer();

    // Open first
    const challengeResult1 = await route(new Request(RESOURCE_URL));
    const challenge1 = Challenge.fromResponse(challengeResult1.challenge);
    const openCred = Credential.from({
      challenge: challenge1,
      payload: {
        action: 'open' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: String(BigInt(challenge1.request.amount)),
        signature: `0x${'ee'.repeat(65)}`,
        txHash: `0x${'aa'.repeat(32)}`,
      },
    });
    await route(new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(openCred) },
    }));

    // Now send a voucher
    const challengeResult2 = await route(new Request(RESOURCE_URL));
    const challenge2 = Challenge.fromResponse(challengeResult2.challenge);
    const voucherCred = Credential.from({
      challenge: challenge2,
      payload: {
        action: 'voucher' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: String(BigInt(challenge2.request.amount) * 2n),
        signature: `0x${'dd'.repeat(65)}`,
      },
    });

    const result = await route(new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(voucherCred) },
    }));

    expect(result.status).toBe(200);
  });

  it('close credential finalizes channel and returns 200', async () => {
    const { route } = createServer();

    // Open
    const cr1 = await route(new Request(RESOURCE_URL));
    const ch1 = Challenge.fromResponse(cr1.challenge);
    const openCred = Credential.from({
      challenge: ch1,
      payload: {
        action: 'open' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: String(BigInt(ch1.request.amount)),
        signature: `0x${'cc'.repeat(65)}`,
        txHash: `0x${'bb'.repeat(32)}`,
      },
    });
    await route(new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(openCred) },
    }));

    // Mock the close tx receipt
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

    // Close
    const cr2 = await route(new Request(RESOURCE_URL));
    const ch2 = Challenge.fromResponse(cr2.challenge);
    const closeCred = Credential.from({
      challenge: ch2,
      payload: {
        action: 'close' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: String(BigInt(ch1.request.amount)),
        signature: `0x${'ab'.repeat(65)}`,
      },
    });

    const result = await route(new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(closeCred) },
    }));

    expect(result.status).toBe(200);
    // writeContract should have been called for the close
    expect(mocks.walletClient.writeContract).toHaveBeenCalled();
  });

  it('expired session challenge is rejected', async () => {
    const sessionHandler = session({
      account: SERVER_ACCOUNT,
      recipient: RECIPIENT,
      escrowContract: ESCROW,
      currency: TOKEN,
      amount: '0.001',
      decimals: 6,
      testnet: true,
      getClients: () => mocks as any,
    });

    const mppx = Mppx.create({
      methods: [sessionHandler],
      realm: REALM,
      secretKey: SECRET_KEY,
    });

    // Create route with already-expired challenge
    const route = mppx.session({
      amount: '0.001',
      currency: TOKEN,
      decimals: 6,
      unitType: 'request',
      recipient: RECIPIENT,
      escrowContract: ESCROW,
      expires: new Date(Date.now() - 10_000).toISOString(),
    });

    // Get expired challenge
    const cr = await route(new Request(RESOURCE_URL));
    const ch = Challenge.fromResponse(cr.challenge);

    const cred = Credential.from({
      challenge: ch,
      payload: {
        action: 'open' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: '1000',
        signature: '0xsig',
        txHash: '0xtx',
      },
    });

    const result = await route(new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(cred) },
    }));

    // Expired challenge → new 402
    expect(result.status).toBe(402);
  });

  it('open returns response with Payment-Receipt header', async () => {
    const { route } = createServer();

    // Get challenge
    const cr = await route(new Request(RESOURCE_URL));
    const ch = Challenge.fromResponse(cr.challenge);

    // Build open credential
    const cred = Credential.from({
      challenge: ch,
      payload: {
        action: 'open' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: String(BigInt(ch.request.amount)),
        signature: `0x${'ff'.repeat(65)}`,
        txHash: `0x${'aa'.repeat(32)}`,
      },
    });

    const result = await route(new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(cred) },
    }));

    expect(result.status).toBe(200);

    // withReceipt should attach Payment-Receipt header
    const response = result.withReceipt(new Response('OK'));
    const receiptHeader = response.headers.get('Payment-Receipt');
    expect(receiptHeader).toBeTruthy();
  });

  it('duplicate voucher with same cumulative is idempotent (not rejected)', async () => {
    const { route } = createServer();

    // Open channel
    const cr1 = await route(new Request(RESOURCE_URL));
    const ch1 = Challenge.fromResponse(cr1.challenge);
    const openCred = Credential.from({
      challenge: ch1,
      payload: {
        action: 'open' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: String(BigInt(ch1.request.amount)),
        signature: `0x${'ff'.repeat(65)}`,
        txHash: `0x${'aa'.repeat(32)}`,
      },
    });
    await route(new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(openCred) },
    }));

    // Send same voucher amount twice — second should be idempotent (return existing receipt)
    const cr2 = await route(new Request(RESOURCE_URL));
    const ch2 = Challenge.fromResponse(cr2.challenge);
    const voucherCred = Credential.from({
      challenge: ch2,
      payload: {
        action: 'voucher' as const,
        channelId: CHANNEL_ID,
        cumulativeAmount: String(BigInt(ch1.request.amount)), // same as open
        signature: `0x${'dd'.repeat(65)}`,
      },
    });

    const result = await route(new Request(RESOURCE_URL, {
      headers: { Authorization: Credential.serialize(voucherCred) },
    }));
    // Session vouchers with lower/equal cumulative return existing receipt, not error
    expect(result.status).toBe(200);
  });

  it('malformed session credential returns 402', async () => {
    const { route } = createServer();

    const result = await route(new Request(RESOURCE_URL, {
      headers: { Authorization: 'Payment not-valid-base64-json' },
    }));

    expect(result.status).toBe(402);
  });
});
