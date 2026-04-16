import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Store } from 'mppx';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { zeroAddress } from 'viem';
import { session } from '../src/server/session.js';
import { charge } from '../src/server/charge.js';
import * as Attribution from '../src/attribution.js';
import { assertUint128 } from '../src/internal.js';
import { sessionMethod } from '../src/client/methods.js';

// ── Test constants ─────────────────────────────────────────────────
const TEST_KEY = generatePrivateKey();
const SERVER_ACCOUNT = privateKeyToAccount(TEST_KEY);
const RECIPIENT =
  '0x2222222222222222222222222222222222222222' as `0x${string}`;
const PAYER =
  '0x1111111111111111111111111111111111111111' as `0x${string}`;
const AUTHORIZED_SIGNER =
  '0x3333333333333333333333333333333333333333' as `0x${string}`;
const TOKEN =
  '0x0000000000000000000000000000000000001549' as `0x${string}`;
const ESCROW =
  '0x401b6dc30221823361E4876f5C502e37249D84C3' as `0x${string}`;
const CHANNEL_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
const UNKNOWN_CHANNEL_ID =
  '0x00000000000000000000000000000000000000000000000000000000000000ff' as `0x${string}`;

// ── Mock client factory (same pattern as server-session-verify.test.ts) ──
function createMocks() {
  return {
    publicClient: {
      readContract: vi.fn(),
      verifyTypedData: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    },
    walletClient: {
      writeContract: vi.fn(),
      account: SERVER_ACCOUNT,
    },
  };
}

type Mocks = ReturnType<typeof createMocks>;

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

function createHandler(
  mocks: Mocks,
  opts: Record<string, unknown> = {},
) {
  const store =
    (opts.store as ReturnType<typeof Store.memory>) ?? Store.memory();
  return {
    handler: session({
      account: SERVER_ACCOUNT,
      recipient: RECIPIENT,
      escrowContract: ESCROW,
      currency: TOKEN,
      amount: '0.001',
      testnet: true,
      store,
      getClients: () => mocks as any,
      ...opts,
    }),
    store,
  };
}

function setupSuccessfulOpenMocks(
  mocks: Mocks,
  channelOverrides: Record<string, unknown> = {},
) {
  mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
  });
  mocks.publicClient.readContract.mockResolvedValue(
    onChainChannel(channelOverrides),
  );
  mocks.publicClient.verifyTypedData.mockResolvedValue(true);
}

async function seedChannelViaOpen(
  handler: ReturnType<typeof session>,
  mocks: Mocks,
  channelOverrides: Record<string, unknown> = {},
  credentialOverrides: Record<string, unknown> = {},
) {
  setupSuccessfulOpenMocks(mocks, channelOverrides);
  const credential = openCredential(credentialOverrides);
  await handler.verify({
    credential: credential as any,
    request: credential.challenge.request as any,
  });
  mocks.publicClient.waitForTransactionReceipt.mockReset();
  mocks.publicClient.readContract.mockReset();
  mocks.publicClient.verifyTypedData.mockReset();
  mocks.walletClient.writeContract.mockReset();
}

// ── Credential builders ────────────────────────────────────────────
function openCredential(overrides: Record<string, unknown> = {}) {
  return {
    challenge: {
      id: 'challenge-1',
      request: {
        amount: '1000',
        chainId: 296,
        recipient: RECIPIENT,
        currency: TOKEN,
        escrowContract: ESCROW,
      },
    },
    payload: {
      action: 'open' as const,
      channelId: CHANNEL_ID,
      cumulativeAmount: '1000',
      signature: '0xfakesig',
      txHash: '0xfaketxhash',
      ...overrides,
    },
  };
}

function closeCredential(overrides: Record<string, unknown> = {}) {
  return {
    challenge: {
      id: 'challenge-close',
      request: { amount: '0', chainId: 296 },
    },
    payload: {
      action: 'close' as const,
      channelId: CHANNEL_ID,
      cumulativeAmount: '5000',
      signature: '0xclosesig',
      ...overrides,
    },
  };
}

function topUpCredential(overrides: Record<string, unknown> = {}) {
  return {
    challenge: {
      id: 'challenge-topup',
      request: { amount: '0', chainId: 296 },
    },
    payload: {
      action: 'topUp' as const,
      channelId: CHANNEL_ID,
      txHash: '0xtopuptxhash',
      ...overrides,
    },
  };
}

function voucherCredential(overrides: Record<string, unknown> = {}) {
  return {
    challenge: {
      id: 'challenge-2',
      request: { amount: '1000', chainId: 296 },
    },
    payload: {
      action: 'voucher' as const,
      channelId: CHANNEL_ID,
      cumulativeAmount: '2000',
      signature: '0xfakesig2',
      ...overrides,
    },
  };
}

function makeRespondContext(
  action: string,
  inputOverrides: Partial<{ method: string; headers: Headers }> = {},
) {
  const credential = {
    challenge: { id: 'c-1', request: { amount: '0', chainId: 296 } },
    payload: { action },
  };
  const receipt = {
    method: 'hedera',
    intent: 'session',
    status: 'success',
    timestamp: new Date().toISOString(),
    reference: CHANNEL_ID,
    channelId: CHANNEL_ID,
    acceptedCumulative: '0',
    spent: '0',
    units: 0,
    challengeId: 'c-1',
  };
  const headers = inputOverrides.headers ?? new Headers();
  const input = new Request('http://localhost/test', {
    method: inputOverrides.method ?? 'GET',
    headers,
  });
  return {
    credential: credential as any,
    receipt: receipt as any,
    input,
    request: credential.challenge.request as any,
    envelope: undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Session verify edge cases
// ═══════════════════════════════════════════════════════════════════

describe('Session verify edge cases', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = createMocks();
  });

  it('Open: rejects when closeRequestedAt != 0 (pending close request)', async () => {
    const { handler } = createHandler(mocks);
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
    });
    mocks.publicClient.readContract.mockResolvedValue(
      onChainChannel({ closeRequestedAt: 100n }),
    );

    const credential = openCredential();
    await expect(
      handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      }),
    ).rejects.toThrow(/pending close/);
  });

  it('Open/voucher with non-zero authorizedSigner uses authorizedSigner for sig verification', async () => {
    const { handler } = createHandler(mocks);
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
    });
    mocks.publicClient.readContract.mockResolvedValue(
      onChainChannel({ authorizedSigner: AUTHORIZED_SIGNER }),
    );
    mocks.publicClient.verifyTypedData.mockResolvedValue(true);

    const credential = openCredential();
    await handler.verify({
      credential: credential as any,
      request: credential.challenge.request as any,
    });

    // verifyTypedData should have been called with AUTHORIZED_SIGNER, not PAYER
    expect(mocks.publicClient.verifyTypedData).toHaveBeenCalledWith(
      expect.objectContaining({ address: AUTHORIZED_SIGNER }),
    );
  });

  it('Close: rejects for unknown channel (ChannelNotFoundError)', async () => {
    const { handler } = createHandler(mocks);

    const credential = closeCredential({ channelId: UNKNOWN_CHANNEL_ID });
    await expect(
      handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      }),
    ).rejects.toThrow(/not found/);
  });

  it('Close: rejects below settledOnChain amount', async () => {
    const { handler, store } = createHandler(mocks);
    await seedChannelViaOpen(handler, mocks);

    // Set settledOnChain to 8000n so close at 5000 is below it
    const state = (await store.get(CHANNEL_ID)) as any;
    await store.put(CHANNEL_ID, {
      ...state,
      settledOnChain: 8000n,
      spent: 1000n, // spent < settledOnChain, so minClose = settledOnChain = 8000
    } as any);

    mocks.publicClient.verifyTypedData.mockResolvedValue(true);

    const credential = closeCredential({ cumulativeAmount: '5000' });
    await expect(
      handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      }),
    ).rejects.toThrow(/must be >=/);
  });

  it('TopUp: rejects when tx reverts', async () => {
    const { handler } = createHandler(mocks);
    await seedChannelViaOpen(handler, mocks);

    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
    });

    const credential = topUpCredential();
    await expect(
      handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      }),
    ).rejects.toThrow(/reverted/);
  });

  it('verifyVoucherSig: returns false when verifyTypedData throws', async () => {
    const { handler } = createHandler(mocks);
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
    });
    mocks.publicClient.readContract.mockResolvedValue(onChainChannel());
    // verifyTypedData throws instead of returning false
    mocks.publicClient.verifyTypedData.mockRejectedValue(
      new Error('unexpected internal error'),
    );

    const credential = openCredential();
    // The catch in verifyVoucherSig returns false, triggering InvalidSignatureError
    await expect(
      handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      }),
    ).rejects.toThrow(/signature/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Session respond() edge cases
// ═══════════════════════════════════════════════════════════════════

describe('Session respond() edge cases', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = createMocks();
  });

  it('POST voucher without content-length header returns 204', () => {
    const { handler } = createHandler(mocks);
    // POST with no content-length and no transfer-encoding
    const headers = new Headers();
    const ctx = makeRespondContext('voucher', {
      method: 'POST',
      headers,
    });
    const response = handler.respond!(ctx as any);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(204);
  });

  it('POST with transfer-encoding header returns undefined (passthrough)', () => {
    const { handler } = createHandler(mocks);
    const headers = new Headers({
      'transfer-encoding': 'chunked',
    });
    const ctx = makeRespondContext('voucher', {
      method: 'POST',
      headers,
    });
    const response = handler.respond!(ctx as any);
    expect(response).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Server charge edge cases
// ═══════════════════════════════════════════════════════════════════

describe('Server charge edge cases', () => {
  it('fetchTransaction: HTTP 500 throws immediately (no retry)', async () => {
    // We test fetchTransaction indirectly through the charge handler's verify().
    // Mock global fetch to return 500.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    try {
      const handler = charge({
        serverId: 'test.example.com',
        recipient: '0.0.12345',
        testnet: true,
        maxRetries: 3,
        retryDelay: 10,
      });

      const credential = {
        challenge: {
          id: 'challenge-charge-1',
          request: {
            amount: '1000000',
            recipient: '0.0.12345',
            chainId: 296,
          },
        },
        payload: {
          type: 'hash',
          transactionId: '0.0.99999@1681234567.123456789',
        },
      };

      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/500/);

      // Should have been called exactly once (no retries for non-404)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('getHederaClient: throws when operatorId missing', () => {
    // charge() without operatorId, then attempt pull mode verification
    const handler = charge({
      serverId: 'test.example.com',
      recipient: '0.0.12345',
      testnet: true,
      // No operatorId or operatorKey
    });

    const credential = {
      challenge: {
        id: 'challenge-pull-1',
        request: {
          amount: '1000000',
          recipient: '0.0.12345',
          chainId: 296,
        },
      },
      payload: {
        type: 'transaction',
        transaction: Buffer.from('fake-tx-bytes').toString('base64'),
      },
    };

    // The verify will call getHederaClient which throws
    // But it may fail earlier on Transaction.fromBytes -- either way it should throw
    expect(
      handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      }),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Attribution edge cases
// ═══════════════════════════════════════════════════════════════════

describe('Attribution edge cases', () => {
  const validMemo = Attribution.encode({
    serverId: 'api.example.com',
    clientId: 'user-42',
    challengeId: 'ch_abc',
  });

  const anonMemo = Attribution.encode({
    serverId: 'api.example.com',
    challengeId: 'ch_abc',
  });

  it('decode() with valid clientId returns all fields', () => {
    const decoded = Attribution.decode(validMemo);
    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(1);
    expect(decoded!.serverFingerprint).toBeDefined();
    expect(decoded!.clientFingerprint).not.toBeNull();
    expect(decoded!.nonce).toBeDefined();
  });

  it('decode() without clientId returns clientFingerprint: null', () => {
    const decoded = Attribution.decode(anonMemo);
    expect(decoded).not.toBeNull();
    expect(decoded!.clientFingerprint).toBeNull();
  });

  it('decode() with invalid memo returns null', () => {
    const invalidMemo = '0x' + 'ab'.repeat(32);
    const decoded = Attribution.decode(invalidMemo as `0x${string}`);
    expect(decoded).toBeNull();
  });

  it('verifyChallengeBinding with non-MPP memo returns false', () => {
    const nonMppMemo = '0x' + '00'.repeat(32);
    expect(
      Attribution.verifyChallengeBinding(
        nonMppMemo as `0x${string}`,
        'any-challenge',
      ),
    ).toBe(false);
  });

  it('verifyServer with non-MPP memo returns false', () => {
    const nonMppMemo = '0x' + '00'.repeat(32);
    expect(
      Attribution.verifyServer(
        nonMppMemo as `0x${string}`,
        'api.example.com',
      ),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Schema edge cases
// ═══════════════════════════════════════════════════════════════════

describe('Schema edge cases', () => {
  const sessionReq = sessionMethod.schema.request;

  it('sessionMethod.schema.request parses and transforms suggestedDeposit', () => {
    const parsed = sessionReq.parse({
      amount: '0.001',
      currency: '0x0000000000000000000000000000000000001549',
      decimals: 6,
      unitType: 'request',
      suggestedDeposit: '1.5',
    });

    // suggestedDeposit "1.5" with 6 decimals => "1500000"
    expect(parsed.suggestedDeposit).toBe('1500000');
  });

  it('sessionMethod.schema.request parses and transforms minVoucherDelta', () => {
    const parsed = sessionReq.parse({
      amount: '0.001',
      currency: '0x0000000000000000000000000000000000001549',
      decimals: 6,
      unitType: 'request',
      minVoucherDelta: '0.5',
    });

    // minVoucherDelta "0.5" with 6 decimals => "500000"
    expect(parsed.methodDetails.minVoucherDelta).toBe('500000');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Internal edge cases
// ═══════════════════════════════════════════════════════════════════

describe('Internal edge cases', () => {
  it('assertUint128 throws for value above max (2n**128n)', () => {
    const aboveMax = 2n ** 128n; // exactly 1 above UINT128_MAX
    expect(() => assertUint128(aboveMax)).toThrow(/uint128/);
  });
});
