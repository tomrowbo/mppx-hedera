import { Errors } from 'mppx';
import { defineChain } from 'viem';
import { bytesToHex } from 'viem';

// ─── Hedera chain definitions ──────────────────────────────────────

export const hederaTestnet = defineChain({
  id: 296,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } },
  blockExplorers: { default: { name: 'Hashscan', url: 'https://hashscan.io/testnet' } },
  testnet: true,
});

export const hederaMainnet = defineChain({
  id: 295,
  name: 'Hedera Mainnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.hashio.io/api'] } },
  blockExplorers: { default: { name: 'Hashscan', url: 'https://hashscan.io/mainnet' } },
});

/** Resolves a Hedera chainId to its viem Chain definition. */
export function resolveChain(chainId: number) {
  if (chainId === hederaTestnet.id) return hederaTestnet;
  if (chainId === hederaMainnet.id) return hederaMainnet;
  throw new Error(
    `Unsupported Hedera chainId ${chainId}, expected ${hederaMainnet.id} (mainnet) or ${hederaTestnet.id} (testnet)`,
  );
}

// ─── Utilities ─────────────────────────────────────────────────────

/** Maximum value for a `uint128` (2^128 - 1). */
export const UINT128_MAX = 2n ** 128n - 1n;

/** Throws if amount is outside uint128 range. */
export function assertUint128(amount: bigint): void {
  if (amount < 0n || amount > UINT128_MAX) {
    throw new Errors.VerificationFailedError({
      reason: `cumulativeAmount exceeds uint128 range`,
    });
  }
}

/** Generates a cryptographically random 32-byte hex string. */
export function randomBytes32(): `0x${string}` {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
