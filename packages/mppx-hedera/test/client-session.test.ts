import { describe, it, expect, vi, beforeEach } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { hederaSession } from '../src/client/session.js';

// ── Test constants ───────────────────────────────────────────────
const TEST_KEY = generatePrivateKey();
const ACCOUNT = privateKeyToAccount(TEST_KEY);
const RECIPIENT =
  '0x2222222222222222222222222222222222222222' as Address;
const TOKEN =
  '0x0000000000000000000000000000000000001549' as Address;
const ESCROW =
  '0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE' as Address;
const CHANNEL_ID =
  '0x00000000000000000000000000000000000000000000000000000000000000ab' as Hex;
const OPEN_TX_HASH =
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Hex;
const VOUCHER_SIG =
  '0xfakesig00000000000000000000000000000000000000000000000000000000' as Hex;

// ── Mock client factories ────────────────────────────────────────
function createMocks() {
  return {
    walletClient: {
      writeContract: vi.fn(),
      signTypedData: vi.fn(),
      account: ACCOUNT,
    },
    publicClient: {
      readContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    },
  };
}

type Mocks = ReturnType<typeof createMocks>;

// ── Build a challenge object that the session client expects ─────
function makeChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'challenge-1',
    method: 'hedera',
    intent: 'session',
    request: {
      amount: '1000',
      currency: TOKEN,
      recipient: RECIPIENT,
      decimals: 6,
      methodDetails: {
        escrowContract: ESCROW,
        chainId: 296,
      },
      ...overrides,
    },
  };
}

// ── Setup mocks for a successful open flow ──────────────────────
function setupOpenMocks(mocks: Mocks) {
  // allowance check returns 0 (insufficient)
  mocks.publicClient.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'allowance') return 0n;
      if (functionName === 'computeChannelId') return CHANNEL_ID;
      throw new Error(`unexpected readContract call: ${functionName}`);
    },
  );
  mocks.walletClient.writeContract.mockResolvedValue(OPEN_TX_HASH);
  mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
  });
  mocks.walletClient.signTypedData.mockResolvedValue(VOUCHER_SIG);
}

// ── Helper: create a session client wired to mocks ──────────────
function createSession(
  mocks: Mocks,
  opts: Record<string, unknown> = {},
) {
  return hederaSession({
    account: ACCOUNT,
    deposit: '10',
    getClient: () => mocks.walletClient as any,
    getPublicClient: () => mocks.publicClient as any,
    ...opts,
  });
}

// ── Helper: extract credential payload from the serialized string
function parseCredential(serialized: string): Record<string, unknown> {
  // Format: "Payment <base64url>"
  const b64 = serialized.replace(/^Payment\s+/, '');
  const json = JSON.parse(
    Buffer.from(b64, 'base64url').toString('utf-8'),
  );
  return json.payload;
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('client session (hederaSession)', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = createMocks();
  });

  // ═══════════════════════════════════════════════════════════════
  // open — escrow resolution
  // ═══════════════════════════════════════════════════════════════
  describe('open — escrow resolution', () => {
    it('resolves escrowContract from methodDetails', async () => {
      setupOpenMocks(mocks);
      const session = createSession(mocks);
      const challenge = makeChallenge();

      await session.createCredential({ challenge, context: undefined });

      // The open writeContract call should use the escrow from methodDetails
      const openCall = mocks.walletClient.writeContract.mock.calls.find(
        (c: any[]) => c[0].functionName === 'open',
      );
      expect(openCall).toBeDefined();
      expect(openCall![0].address).toBe(ESCROW);
    });

    it('throws when escrowContract missing and no default', async () => {
      setupOpenMocks(mocks);
      // No escrowContract in options, no methodDetails, and chainId=999 has no default
      const session = createSession(mocks, { escrowContract: undefined });
      const challenge = makeChallenge();
      // Remove escrowContract from methodDetails and use unsupported chain
      challenge.request.methodDetails = { chainId: 999 };

      await expect(
        session.createCredential({ challenge, context: undefined }),
      ).rejects.toThrow(/escrowContract required/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // open — deposit resolution
  // ═══════════════════════════════════════════════════════════════
  describe('open — deposit resolution', () => {
    it('resolves deposit from suggestedDeposit in challenge', async () => {
      setupOpenMocks(mocks);
      // No options.deposit, rely on suggestedDeposit
      const session = createSession(mocks, { deposit: undefined });
      const challenge = makeChallenge({ suggestedDeposit: '5000000' });

      await session.createCredential({ challenge, context: undefined });

      // The approve call should use the suggestedDeposit value (5000000)
      const approveCall = mocks.walletClient.writeContract.mock.calls.find(
        (c: any[]) => c[0].functionName === 'approve',
      );
      expect(approveCall).toBeDefined();
      expect(approveCall![0].args[1]).toBe(5000000n);
    });

    it('resolves deposit from options.deposit', async () => {
      setupOpenMocks(mocks);
      const session = createSession(mocks, { deposit: '10' });
      const challenge = makeChallenge(); // no suggestedDeposit

      await session.createCredential({ challenge, context: undefined });

      // options.deposit = '10' with 6 decimals = 10_000_000n
      const approveCall = mocks.walletClient.writeContract.mock.calls.find(
        (c: any[]) => c[0].functionName === 'approve',
      );
      expect(approveCall).toBeDefined();
      expect(approveCall![0].args[1]).toBe(10_000_000n);
    });

    it('throws when no deposit available', async () => {
      setupOpenMocks(mocks);
      // No options.deposit and no suggestedDeposit in challenge
      const session = createSession(mocks, { deposit: undefined });
      const challenge = makeChallenge();

      await expect(
        session.createCredential({ challenge, context: undefined }),
      ).rejects.toThrow(/deposit required/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // open — allowance / approve
  // ═══════════════════════════════════════════════════════════════
  describe('open — allowance / approve', () => {
    it('checks allowance and approves when insufficient', async () => {
      setupOpenMocks(mocks);
      // allowance returns 0 (default in setupOpenMocks)
      const session = createSession(mocks);
      const challenge = makeChallenge();

      await session.createCredential({ challenge, context: undefined });

      // Should have called allowance check
      const allowanceCall = mocks.publicClient.readContract.mock.calls.find(
        (c: any[]) => c[0].functionName === 'allowance',
      );
      expect(allowanceCall).toBeDefined();

      // Should have called approve
      const approveCall = mocks.walletClient.writeContract.mock.calls.find(
        (c: any[]) => c[0].functionName === 'approve',
      );
      expect(approveCall).toBeDefined();
    });

    it('skips approve when allowance sufficient', async () => {
      // Override allowance to return a large value
      mocks.publicClient.readContract.mockImplementation(
        async ({ functionName }: { functionName: string }) => {
          if (functionName === 'allowance') return 999_000_000n; // way more than 10 USDC
          if (functionName === 'computeChannelId') return CHANNEL_ID;
          throw new Error(`unexpected readContract: ${functionName}`);
        },
      );
      mocks.walletClient.writeContract.mockResolvedValue(OPEN_TX_HASH);
      mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
        status: 'success',
      });
      mocks.walletClient.signTypedData.mockResolvedValue(VOUCHER_SIG);

      const session = createSession(mocks);
      const challenge = makeChallenge();

      await session.createCredential({ challenge, context: undefined });

      // Should NOT have called approve — only the open call
      const approveCall = mocks.walletClient.writeContract.mock.calls.find(
        (c: any[]) => c[0].functionName === 'approve',
      );
      expect(approveCall).toBeUndefined();

      // Should still have called open
      const openCall = mocks.walletClient.writeContract.mock.calls.find(
        (c: any[]) => c[0].functionName === 'open',
      );
      expect(openCall).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // open — onChannelOpened callback
  // ═══════════════════════════════════════════════════════════════
  describe('open — onChannelOpened callback', () => {
    it('calls onChannelOpened callback', async () => {
      setupOpenMocks(mocks);
      const onChannelOpened = vi.fn();
      const session = createSession(mocks, { onChannelOpened });
      const challenge = makeChallenge();

      await session.createCredential({ challenge, context: undefined });

      expect(onChannelOpened).toHaveBeenCalledOnce();
      expect(onChannelOpened).toHaveBeenCalledWith(CHANNEL_ID);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // open — credential shape
  // ═══════════════════════════════════════════════════════════════
  describe('open — credential result', () => {
    it('returns credential with action:open, channelId, txHash, signature', async () => {
      setupOpenMocks(mocks);
      const session = createSession(mocks);
      const challenge = makeChallenge();

      const result = await session.createCredential({
        challenge,
        context: undefined,
      });

      // Result is a serialized credential string
      expect(typeof result).toBe('string');
      const payload = parseCredential(result as string);

      expect(payload.action).toBe('open');
      expect(payload.channelId).toBe(CHANNEL_ID);
      expect(payload.txHash).toBe(OPEN_TX_HASH);
      expect(payload.signature).toBe(VOUCHER_SIG);
      expect(payload.cumulativeAmount).toBe('1000');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // voucher
  // ═══════════════════════════════════════════════════════════════
  describe('voucher', () => {
    it('increments cumulative and returns action:voucher', async () => {
      setupOpenMocks(mocks);
      const session = createSession(mocks);
      const challenge1 = makeChallenge();

      // First call opens the channel
      await session.createCredential({
        challenge: challenge1,
        context: undefined,
      });

      // Reset signTypedData to track new calls
      mocks.walletClient.signTypedData.mockClear();
      const voucherSig2 =
        '0xsecondvouchersig0000000000000000000000000000000000000000000000' as Hex;
      mocks.walletClient.signTypedData.mockResolvedValue(voucherSig2);

      // Second call to the same payee/currency/escrow should produce a voucher
      const challenge2 = makeChallenge({ amount: '500' });
      const result = await session.createCredential({
        challenge: challenge2,
        context: undefined,
      });

      const payload = parseCredential(result as string);
      expect(payload.action).toBe('voucher');
      expect(payload.channelId).toBe(CHANNEL_ID);
      // cumulative: 1000 (from open) + 500 = 1500
      expect(payload.cumulativeAmount).toBe('1500');
      expect(payload.signature).toBe(voucherSig2);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // channel reuse
  // ═══════════════════════════════════════════════════════════════
  describe('channel reuse', () => {
    it('same payee/currency/escrow reuses existing channel', async () => {
      setupOpenMocks(mocks);
      const session = createSession(mocks);

      // First call opens the channel
      await session.createCredential({
        challenge: makeChallenge(),
        context: undefined,
      });

      const openCallCount = mocks.walletClient.writeContract.mock.calls.filter(
        (c: any[]) => c[0].functionName === 'open',
      ).length;
      expect(openCallCount).toBe(1);

      // Second call with same payee/currency/escrow
      mocks.walletClient.signTypedData.mockResolvedValue(VOUCHER_SIG);
      await session.createCredential({
        challenge: makeChallenge({ amount: '200' }),
        context: undefined,
      });

      // Should not have called open again
      const totalOpenCalls = mocks.walletClient.writeContract.mock.calls.filter(
        (c: any[]) => c[0].functionName === 'open',
      ).length;
      expect(totalOpenCalls).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // new channel for different payee
  // ═══════════════════════════════════════════════════════════════
  describe('new channel for different payee', () => {
    it('different payee creates new channel entry', async () => {
      setupOpenMocks(mocks);
      const session = createSession(mocks);

      // First call opens a channel for RECIPIENT
      await session.createCredential({
        challenge: makeChallenge(),
        context: undefined,
      });

      const DIFFERENT_PAYEE =
        '0x3333333333333333333333333333333333333333' as Address;
      const DIFFERENT_CHANNEL_ID =
        '0x00000000000000000000000000000000000000000000000000000000000000cd' as Hex;

      // For the second open, computeChannelId returns a different ID
      mocks.publicClient.readContract.mockImplementation(
        async ({ functionName }: { functionName: string }) => {
          if (functionName === 'allowance') return 0n;
          if (functionName === 'computeChannelId') return DIFFERENT_CHANNEL_ID;
          throw new Error(`unexpected readContract: ${functionName}`);
        },
      );
      mocks.walletClient.writeContract.mockResolvedValue(OPEN_TX_HASH);
      mocks.walletClient.signTypedData.mockResolvedValue(VOUCHER_SIG);

      // Second call with different payee triggers a new open
      const challenge2 = makeChallenge({ recipient: DIFFERENT_PAYEE });
      const result = await session.createCredential({
        challenge: challenge2,
        context: undefined,
      });

      const payload = parseCredential(result as string);
      expect(payload.action).toBe('open');
      expect(payload.channelId).toBe(DIFFERENT_CHANNEL_ID);

      // Should have called open twice total
      const totalOpenCalls = mocks.walletClient.writeContract.mock.calls.filter(
        (c: any[]) => c[0].functionName === 'open',
      ).length;
      expect(totalOpenCalls).toBe(2);
    });
  });
});
