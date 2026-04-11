/**
 * mppx-hedera/server — charge intent verification
 *
 * Server-side: verifies that an ERC-20 transfer actually landed on Hedera
 * with the correct amount, recipient, and token.
 *
 * Ported from @stablecoin.xyz/radius-mpp (MIT) with Hedera chain config,
 * typed errors from mppx core, and Store-based idempotency.
 */

import { Errors, Method, Receipt, Store } from 'mppx';
import {
  createPublicClient,
  http,
  decodeEventLog,
  erc20Abi,
  type Log,
} from 'viem';
import { chargeMethod } from '../client/methods.ts';
import { resolveChain } from '../internal.ts';
import { DEFAULT_CURRENCY } from '../constants.ts';

export interface HederaChargeServerOptions {
  /** Override the RPC URL (defaults to the chain's Hashio endpoint). */
  rpcUrl?: string;
  /** Number of confirmations to require. Defaults to 1. */
  confirmations?: number;
  /** Pluggable store for idempotency. Defaults to in-memory. */
  store?: Store.Store;
}

/**
 * Creates a server-side Hedera charge handler that verifies ERC-20 Transfer
 * events from the tx receipt. No facilitator — reads Hashio directly.
 */
export function charge(config: HederaChargeServerOptions = {}) {
  const { confirmations = 1 } = config;
  const store = config.store ?? Store.memory();

  return Method.toServer(chargeMethod, {
    async verify({ credential }) {
      const { txHash } = credential.payload;
      const { amount, chainId, recipient, payer } = credential.challenge.request;
      const token = credential.challenge.request.token ?? DEFAULT_CURRENCY[chainId];

      const chain = resolveChain(chainId);
      const rpcUrl = config.rpcUrl ?? chain.rpcUrls.default.http[0];
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

      // Idempotency: reject tx reuse
      const storeKey = `hedera:charge:${txHash}`;
      const seen = await store.get(storeKey);
      if (seen !== null) {
        throw new Errors.VerificationFailedError({
          reason: 'Transaction hash already used',
        });
      }

      // Fetch the receipt via Hashio JSON-RPC
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (receipt.status !== 'success') {
        throw new Errors.VerificationFailedError({
          reason: `Transaction reverted on-chain (status: ${receipt.status})`,
        });
      }

      // Optional payer check
      if (payer && receipt.from.toLowerCase() !== payer.toLowerCase()) {
        throw new Errors.VerificationFailedError({
          reason: `Transaction sender ${receipt.from} does not match expected payer ${payer}`,
        });
      }

      // Verify the tx was sent to the correct token contract
      if (receipt.to?.toLowerCase() !== token?.toLowerCase()) {
        throw new Errors.VerificationFailedError({
          reason: `Transaction target ${receipt.to} does not match expected token ${token}`,
        });
      }

      // Find the ERC-20 Transfer event matching recipient + amount
      const transferLog = findMatchingTransferLog(
        receipt.logs,
        token!,
        recipient,
        BigInt(amount),
      );

      if (!transferLog) {
        throw new Errors.VerificationFailedError({
          reason: `No matching ERC-20 Transfer event found for recipient ${recipient} with amount ${amount}`,
        });
      }

      // Wait for additional confirmations if configured
      if (confirmations > 1) {
        await publicClient.waitForTransactionReceipt({
          hash: txHash as `0x${string}`,
          confirmations,
        });
      }

      // Mark as used
      await store.set(storeKey, Date.now());

      return Receipt.from({
        method: 'hedera',
        reference: txHash,
        status: 'success',
        timestamp: new Date().toISOString(),
      });
    },
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

function findMatchingTransferLog(
  logs: Log[],
  token: string,
  recipient: string,
  minAmount: bigint,
) {
  for (const log of logs) {
    if (log.address.toLowerCase() !== token.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'Transfer') continue;
      const { to, value } = decoded.args as { to: `0x${string}`; value: bigint };
      if (
        to.toLowerCase() === recipient.toLowerCase() &&
        value >= minAmount
      ) {
        return { to, value };
      }
    } catch {
      continue;
    }
  }
  return null;
}
