import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Store } from 'mppx';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { session } from '../src/server/session.js';
import { zeroAddress } from 'viem';

// ── Test constants ───────────────────────────────────────────────
const TEST_KEY = generatePrivateKey();
const SERVER_ACCOUNT = privateKeyToAccount(TEST_KEY);
const RECIPIENT =
  '0x2222222222222222222222222222222222222222' as `0x${string}`;
const PAYER =
  '0x1111111111111111111111111111111111111111' as `0x${string}`;
const TOKEN =
  '0x0000000000000000000000000000000000001549' as `0x${string}`;
const ESCROW =
  '0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE' as `0x${string}`;
const CHANNEL_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
const UNKNOWN_CHANNEL_ID =
  '0x00000000000000000000000000000000000000000000000000000000000000ff' as `0x${string}`;

// ── Mock client factory ──────────────────────────────────────────
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

// ── On-chain channel struct (what readContract returns for getChannel) ──
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

// ── Create session handler with mocks ────────────────────────────
function createHandler(
  mocks: Mocks,
  opts: Record<string, unknown> = {},
) {
  const store = (opts.store as ReturnType<typeof Store.memory>) ?? Store.memory();
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

// ── Build credential objects ─────────────────────────────────────
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

function voucherCredential(overrides: Record<string, unknown> = {}) {
  return {
    challenge: {
      id: 'challenge-2',
      request: {
        amount: '1000',
        chainId: 296,
      },
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

function closeCredential(overrides: Record<string, unknown> = {}) {
  return {
    challenge: {
      id: 'challenge-close',
      request: {
        amount: '0',
        chainId: 296,
      },
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
      request: {
        amount: '0',
        chainId: 296,
      },
    },
    payload: {
      action: 'topUp' as const,
      channelId: CHANNEL_ID,
      txHash: '0xtopuptxhash',
      ...overrides,
    },
  };
}

// ── Helper: setup mocks for a successful open ────────────────────
function setupSuccessfulOpenMocks(mocks: Mocks, channelOverrides: Record<string, unknown> = {}) {
  mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
  });
  mocks.publicClient.readContract.mockResolvedValue(
    onChainChannel(channelOverrides),
  );
  mocks.publicClient.verifyTypedData.mockResolvedValue(true);
}

// ── Helper: run a full successful open to seed channel state ─────
async function seedChannelViaOpen(
  handler: ReturnType<typeof session>,
  mocks: Mocks,
  channelOverrides: Record<string, unknown> = {},
  credentialOverrides: Record<string, unknown> = {},
) {
  setupSuccessfulOpenMocks(mocks, channelOverrides);
  const credential = openCredential(credentialOverrides);
  const receipt = await handler.verify({
    credential: credential as any,
    request: credential.challenge.request as any,
  });
  // Reset mocks so subsequent calls start clean
  mocks.publicClient.waitForTransactionReceipt.mockReset();
  mocks.publicClient.readContract.mockReset();
  mocks.publicClient.verifyTypedData.mockReset();
  mocks.walletClient.writeContract.mockReset();
  return receipt;
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('server session verify', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = createMocks();
  });

  // ═══════════════════════════════════════════════════════════════
  // open action
  // ═══════════════════════════════════════════════════════════════
  describe('open action', () => {
    it('accepts valid open with funded on-chain channel', async () => {
      const { handler } = createHandler(mocks);
      setupSuccessfulOpenMocks(mocks);

      const credential = openCredential();
      const receipt = await handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      });

      expect(receipt.status).toBe('success');
      expect(receipt.channelId).toBe(CHANNEL_ID);
      expect(receipt.units).toBe(1);
    });

    it('rejects when open tx reverted', async () => {
      const { handler } = createHandler(mocks);
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'reverted',
      });

      const credential = openCredential();
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/reverted/);
    });

    it('rejects when channel not funded on-chain', async () => {
      const { handler } = createHandler(mocks);
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      mocks.publicClient.readContract.mockResolvedValue(
        onChainChannel({ deposit: 0n }),
      );

      const credential = openCredential();
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/not funded/);
    });

    it('rejects when channel is finalized', async () => {
      const { handler } = createHandler(mocks);
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      mocks.publicClient.readContract.mockResolvedValue(
        onChainChannel({ finalized: true }),
      );

      const credential = openCredential();
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/finalized/);
    });

    it('rejects when payee mismatch', async () => {
      const { handler } = createHandler(mocks);
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      mocks.publicClient.readContract.mockResolvedValue(
        onChainChannel({
          payee: '0x3333333333333333333333333333333333333333',
        }),
      );

      const credential = openCredential();
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/payee/);
    });

    it('rejects when token mismatch', async () => {
      const { handler } = createHandler(mocks);
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      mocks.publicClient.readContract.mockResolvedValue(
        onChainChannel({
          token: '0x4444444444444444444444444444444444444444',
        }),
      );

      const credential = openCredential();
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/token/);
    });

    it('rejects invalid voucher signature', async () => {
      const { handler } = createHandler(mocks);
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      mocks.publicClient.readContract.mockResolvedValue(onChainChannel());
      mocks.publicClient.verifyTypedData.mockResolvedValue(false);

      const credential = openCredential();
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/signature/);
    });

    it('rejects when cumulativeAmount exceeds deposit', async () => {
      const { handler } = createHandler(mocks);
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      mocks.publicClient.readContract.mockResolvedValue(onChainChannel());
      mocks.publicClient.verifyTypedData.mockResolvedValue(true);

      const credential = openCredential({ cumulativeAmount: '9999999' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/exceeds deposit/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // voucher action
  // ═══════════════════════════════════════════════════════════════
  describe('voucher action', () => {
    it('accepts voucher with higher cumulative amount', async () => {
      const { handler } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);

      const credential = voucherCredential({ cumulativeAmount: '2000' });
      const receipt = await handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      });

      expect(receipt.status).toBe('success');
      expect(receipt.acceptedCumulative).toBe('2000');
    });

    it('returns existing receipt for lower/equal cumulative', async () => {
      const { handler } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      // Send voucher with amount <= highestVoucherAmount (1000 from open)
      const credential = voucherCredential({ cumulativeAmount: '500' });
      const receipt = await handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      });

      expect(receipt.status).toBe('success');
      // Should return the existing highest (1000), not the lower one
      expect(receipt.acceptedCumulative).toBe('1000');
    });

    it('rejects voucher exceeding deposit', async () => {
      const { handler } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);

      const credential = voucherCredential({ cumulativeAmount: '9999999' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/exceeds deposit/);
    });

    it('rejects voucher with invalid signature', async () => {
      const { handler } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(false);

      const credential = voucherCredential({ cumulativeAmount: '2000' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/signature/);
    });

    it('rejects voucher for unknown channel', async () => {
      const { handler } = createHandler(mocks);

      const credential = voucherCredential({
        channelId: UNKNOWN_CHANNEL_ID,
      });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/not found/);
    });

    it('rejects voucher for finalized channel', async () => {
      const { handler, store } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      // Manually finalize the channel in the store
      await store.put(CHANNEL_ID, {
        ...(await store.get(CHANNEL_ID)),
        finalized: true,
      } as any);

      const credential = voucherCredential({ cumulativeAmount: '2000' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/finalized/);
    });

    it('enforces minVoucherDelta', async () => {
      const { handler } = createHandler(mocks, {
        minVoucherDelta: '0.000500',
      });
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);

      // Delta of 100 when min is 500
      const credential = voucherCredential({ cumulativeAmount: '1100' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/delta/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // topUp action
  // ═══════════════════════════════════════════════════════════════
  describe('topUp action', () => {
    it('accepts topUp when deposit increased', async () => {
      const { handler, store } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      mocks.publicClient.readContract.mockResolvedValue(
        onChainChannel({ deposit: 2000000n }),
      );

      const credential = topUpCredential();
      const receipt = await handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      });

      expect(receipt.status).toBe('success');

      // Verify store was updated with new deposit
      const channelState = (await store.get(CHANNEL_ID)) as any;
      expect(channelState.deposit).toBe(2000000n);
    });

    it('rejects when deposit did not increase', async () => {
      const { handler } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      // Same deposit as before (1000000n)
      mocks.publicClient.readContract.mockResolvedValue(
        onChainChannel({ deposit: 1000000n }),
      );

      const credential = topUpCredential();
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/did not increase/);
    });

    it('rejects topUp for unknown channel', async () => {
      const { handler } = createHandler(mocks);

      const credential = topUpCredential({ channelId: UNKNOWN_CHANNEL_ID });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/not found/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // close action
  // ═══════════════════════════════════════════════════════════════
  describe('close action', () => {
    it('calls writeContract with correct args', async () => {
      const { handler } = createHandler(mocks);
      // Open with some spent
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);
      mocks.walletClient.writeContract.mockResolvedValue('0xclosetxhash');
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });

      const credential = closeCredential({
        cumulativeAmount: '5000',
        signature: '0xclosesig',
      });
      await handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      });

      expect(mocks.walletClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'close',
          args: [CHANNEL_ID, 5000n, '0xclosesig'],
        }),
      );
    });

    it('marks channel as finalized in store', async () => {
      const { handler, store } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);
      mocks.walletClient.writeContract.mockResolvedValue('0xclosetxhash');
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });

      const credential = closeCredential({ cumulativeAmount: '5000' });
      await handler.verify({
        credential: credential as any,
        request: credential.challenge.request as any,
      });

      const channelState = (await store.get(CHANNEL_ID)) as any;
      expect(channelState.finalized).toBe(true);
    });

    it('rejects close below spent amount', async () => {
      const { handler, store } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      // Simulate spending by adding vouchers to bump spent
      const state = (await store.get(CHANNEL_ID)) as any;
      await store.put(CHANNEL_ID, {
        ...state,
        spent: 5000n,
        highestVoucherAmount: 5000n,
      } as any);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);

      const credential = closeCredential({ cumulativeAmount: '3000' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/must be >=/);
    });

    it('rejects close exceeding deposit', async () => {
      const { handler } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);

      const credential = closeCredential({ cumulativeAmount: '9999999' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/exceeds deposit/);
    });

    it('rejects invalid close signature', async () => {
      const { handler } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(false);

      const credential = closeCredential({ cumulativeAmount: '5000' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/signature/);
    });

    it('rejects close for already finalized channel', async () => {
      const { handler, store } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      // Manually finalize the channel
      const state = (await store.get(CHANNEL_ID)) as any;
      await store.put(CHANNEL_ID, { ...state, finalized: true } as any);

      const credential = closeCredential({ cumulativeAmount: '5000' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/finalized/);
    });

    it('rejects close tx that reverts', async () => {
      const { handler } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);
      mocks.walletClient.writeContract.mockResolvedValue('0xclosetxhash');
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'reverted',
      });

      const credential = closeCredential({ cumulativeAmount: '5000' });
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/reverted/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // unknown action
  // ═══════════════════════════════════════════════════════════════
  describe('unknown action', () => {
    it('rejects unknown action', async () => {
      const { handler } = createHandler(mocks);

      const credential = {
        challenge: {
          id: 'challenge-unknown',
          request: { amount: '0', chainId: 296 },
        },
        payload: { action: 'invalid' },
      };
      await expect(
        handler.verify({
          credential: credential as any,
          request: credential.challenge.request as any,
        }),
      ).rejects.toThrow(/unknown/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // channel state tracking
  // ═══════════════════════════════════════════════════════════════
  describe('channel state tracking', () => {
    it('spent increases correctly across vouchers', async () => {
      const { handler, store } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      // First voucher: cumulative 2000, challenge amount 1000
      mocks.publicClient.verifyTypedData.mockResolvedValue(true);
      const v1 = voucherCredential({ cumulativeAmount: '2000' });
      await handler.verify({
        credential: v1 as any,
        request: v1.challenge.request as any,
      });

      let state = (await store.get(CHANNEL_ID)) as any;
      // open spent 1000, voucher spent another 1000 = 2000
      expect(state.spent).toBe(2000n);

      // Second voucher: cumulative 3000, challenge amount 1000
      mocks.publicClient.verifyTypedData.mockResolvedValue(true);
      const v2 = voucherCredential({ cumulativeAmount: '3000' });
      await handler.verify({
        credential: v2 as any,
        request: v2.challenge.request as any,
      });

      state = (await store.get(CHANNEL_ID)) as any;
      expect(state.spent).toBe(3000n);
    });

    it('units count increases correctly', async () => {
      const { handler, store } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      let state = (await store.get(CHANNEL_ID)) as any;
      expect(state.units).toBe(1); // after open

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);
      const v1 = voucherCredential({ cumulativeAmount: '2000' });
      await handler.verify({
        credential: v1 as any,
        request: v1.challenge.request as any,
      });

      state = (await store.get(CHANNEL_ID)) as any;
      expect(state.units).toBe(2);

      mocks.publicClient.verifyTypedData.mockResolvedValue(true);
      const v2 = voucherCredential({ cumulativeAmount: '3000' });
      await handler.verify({
        credential: v2 as any,
        request: v2.challenge.request as any,
      });

      state = (await store.get(CHANNEL_ID)) as any;
      expect(state.units).toBe(3);
    });

    it('highestVoucherAmount only increases', async () => {
      const { handler, store } = createHandler(mocks);
      await seedChannelViaOpen(handler, mocks);

      // Send higher voucher
      mocks.publicClient.verifyTypedData.mockResolvedValue(true);
      const v1 = voucherCredential({ cumulativeAmount: '5000' });
      await handler.verify({
        credential: v1 as any,
        request: v1.challenge.request as any,
      });

      let state = (await store.get(CHANNEL_ID)) as any;
      expect(state.highestVoucherAmount).toBe(5000n);

      // Send lower voucher -- should not decrease
      const v2 = voucherCredential({ cumulativeAmount: '3000' });
      await handler.verify({
        credential: v2 as any,
        request: v2.challenge.request as any,
      });

      state = (await store.get(CHANNEL_ID)) as any;
      expect(state.highestVoucherAmount).toBe(5000n);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // respond hook
  // ═══════════════════════════════════════════════════════════════
  describe('respond hook', () => {
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
      return { credential: credential as any, receipt: receipt as any, input, request: credential.challenge.request as any, envelope: undefined };
    }

    it('returns 204 for close action', () => {
      const { handler } = createHandler(mocks);
      const ctx = makeRespondContext('close');
      const response = handler.respond!(ctx as any);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(204);
    });

    it('returns 204 for topUp action', () => {
      const { handler } = createHandler(mocks);
      const ctx = makeRespondContext('topUp');
      const response = handler.respond!(ctx as any);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(204);
    });

    it('returns undefined for voucher with body', () => {
      const { handler } = createHandler(mocks);
      const headers = new Headers({
        'content-length': '42',
      });
      const ctx = makeRespondContext('voucher', {
        method: 'POST',
        headers,
      });
      const response = handler.respond!(ctx as any);
      expect(response).toBeUndefined();
    });
  });
});
