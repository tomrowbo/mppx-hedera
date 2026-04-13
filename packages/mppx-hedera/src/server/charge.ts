/**
 * mppx-hedera/server — charge intent verification via Mirror Node
 *
 * Server-side: verifies a Hedera native token transfer by querying the
 * Mirror Node REST API. Checks:
 *   1. Transaction exists and succeeded
 *   2. Attribution memo is bound to this challenge (replay protection)
 *   3. Token transfer matches expected amount, recipient, and token
 *   4. Transaction ID has not been used before (idempotency)
 *
 * No facilitator — reads Mirror Node directly.
 */

import { Errors, Method, Receipt, Store } from 'mppx';
import { chargeMethod } from '../client/methods.js';
import { resolveMirrorNode, formatTxIdForMirrorNode } from '../internal.js';
import { DEFAULT_TOKEN_ID } from '../constants.js';
import * as Attribution from '../attribution.js';

export interface HederaChargeServerOptions {
  /** Server identity for Attribution memo verification. Must match what clients use. */
  serverId: string;
  /** Override the Mirror Node REST API base URL. */
  mirrorNodeUrl?: string;
  /** Pluggable store for idempotency. Defaults to in-memory. */
  store?: Store.Store;
  /** Max retries when Mirror Node hasn't indexed the tx yet. Defaults to 10. */
  maxRetries?: number;
  /** Delay in ms between retries. Defaults to 2000. */
  retryDelay?: number;
}

/**
 * Creates a server-side Hedera charge handler that verifies native token
 * transfers via the Mirror Node REST API with challenge-bound memo verification.
 *
 * @example
 * ```ts
 * import { Mppx } from 'mppx/server'
 * import { hedera } from 'mppx-hedera/server'
 *
 * const mppx = Mppx.create({
 *   methods: [hedera.charge({ serverId: 'api.example.com' })],
 *   secretKey: process.env.MPP_SECRET_KEY!,
 * })
 * ```
 */
export function charge(config: HederaChargeServerOptions) {
  const { serverId, maxRetries = 10, retryDelay = 2000 } = config;
  const store = config.store ?? Store.memory();

  return Method.toServer(chargeMethod, {
    async verify({ credential }) {
      const { transactionId } = credential.payload;
      const { amount, chainId, recipient } = credential.challenge.request;
      const tokenId = DEFAULT_TOKEN_ID[chainId];

      const mirrorNodeUrl =
        config.mirrorNodeUrl ?? resolveMirrorNode(chainId);

      // ── 1. Idempotency: reject tx reuse ──────────────────────────
      const storeKey = `hedera:charge:${transactionId}`;
      const seen = await store.get(storeKey);
      if (seen !== null) {
        throw new Errors.VerificationFailedError({
          reason: 'Transaction ID already used',
        });
      }

      // ── 2. Fetch transaction from Mirror Node ────────────────────
      const urlTxId = formatTxIdForMirrorNode(transactionId);
      const tx = await fetchTransaction(mirrorNodeUrl, urlTxId, maxRetries, retryDelay);

      if (tx.result !== 'SUCCESS') {
        throw new Errors.VerificationFailedError({
          reason: `Transaction result: ${tx.result}`,
        });
      }

      // ── 3. Verify Attribution memo (challenge binding) ───────────
      const memoHex = decodeMemoBase64(tx.memo_base64);

      if (!Attribution.isMppMemo(memoHex)) {
        throw new Errors.VerificationFailedError({
          reason: 'Transaction memo is not a valid MPP attribution memo',
        });
      }

      if (!Attribution.verifyServer(memoHex, serverId)) {
        throw new Errors.VerificationFailedError({
          reason: 'Memo server fingerprint does not match',
        });
      }

      const challengeId = credential.challenge.id as string;
      if (!Attribution.verifyChallengeBinding(memoHex, challengeId)) {
        throw new Errors.VerificationFailedError({
          reason: 'Memo challenge nonce does not match — possible replay',
        });
      }

      // ── 4. Verify token transfer (amount + recipient + token) ────
      const tokenTransfers: {
        token_id: string;
        account: string;
        amount: number;
      }[] = tx.token_transfers ?? [];

      const matchingCredit = tokenTransfers.find(
        (t) =>
          t.token_id === tokenId &&
          t.account === recipient &&
          BigInt(t.amount) >= BigInt(amount),
      );

      if (!matchingCredit) {
        throw new Errors.VerificationFailedError({
          reason: `No matching token transfer: expected ${amount} of ${tokenId} to ${recipient}`,
        });
      }

      // ── 5. Mark as used ──────────────────────────────────────────
      await store.set(storeKey, Date.now());

      return Receipt.from({
        method: 'hedera',
        reference: transactionId,
        status: 'success',
        timestamp: new Date().toISOString(),
      });
    },
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Fetches a transaction from the Mirror Node REST API with retry logic
 * to handle the 3-5 second indexing lag after consensus.
 */
async function fetchTransaction(
  mirrorNodeUrl: string,
  urlTxId: string,
  maxRetries: number,
  retryDelay: number,
): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(
      `${mirrorNodeUrl}/api/v1/transactions/${urlTxId}`,
    );

    if (resp.ok) {
      const data = await resp.json();
      if (data?.transactions?.length) return data.transactions[0];
    }

    if (resp.status === 404 && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelay));
      continue;
    }

    throw new Error(
      `Mirror Node returned ${resp.status} for transaction ${urlTxId}`,
    );
  }

  throw new Error(`Transaction ${urlTxId} not found after ${maxRetries} retries`);
}

/**
 * Decodes the base64-encoded memo from the Mirror Node response
 * into the hex string used by Attribution.
 */
function decodeMemoBase64(memoBase64: string): `0x${string}` {
  if (!memoBase64) return '0x' as `0x${string}`;
  const decoded = Buffer.from(memoBase64, 'base64').toString('utf-8');
  // The memo is stored as a "0x..." hex string
  if (decoded.startsWith('0x') && decoded.length === 66) {
    return decoded as `0x${string}`;
  }
  return '0x' as `0x${string}`;
}
