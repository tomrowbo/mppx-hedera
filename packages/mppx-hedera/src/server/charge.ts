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
import {
  Transaction,
  Client as HederaClient,
  AccountId,
  PrivateKey,
} from '@hashgraph/sdk';
import { chargeMethod } from '../client/methods.js';
import { resolveMirrorNode, formatTxIdForMirrorNode } from '../internal.js';
import { DEFAULT_TOKEN_ID } from '../constants.js';
import * as Attribution from '../attribution.js';

export interface HederaChargeServerOptions {
  /** Server identity for Attribution memo verification. Must match what clients use. */
  serverId: string;
  /** Hedera account ID of the payment recipient, e.g. "0.0.12345". */
  recipient: string;
  /** Whether to use Hedera testnet (chainId 296). Defaults to false (mainnet, chainId 295). */
  testnet?: boolean;
  /** Override the Mirror Node REST API base URL. */
  mirrorNodeUrl?: string;
  /** Pluggable store for idempotency. Defaults to in-memory. */
  store?: Store.Store;
  /** Max retries when Mirror Node hasn't indexed the tx yet. Defaults to 10. */
  maxRetries?: number;
  /** Delay in ms between retries. Defaults to 2000. */
  retryDelay?: number;
  /** Server's Hedera account ID (needed for pull mode to submit tx). */
  operatorId?: string;
  /** Server's private key (needed for pull mode to submit tx). */
  operatorKey?: string;
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
  const chainId = config.testnet ? 296 : 295;

  // Lazily created Hedera client for pull mode (submitting transactions)
  let _hederaClient: InstanceType<typeof HederaClient> | null = null;
  function getHederaClient(): InstanceType<typeof HederaClient> {
    if (_hederaClient) return _hederaClient;
    if (!config.operatorId || !config.operatorKey) {
      throw new Error(
        'Pull mode requires operatorId and operatorKey in server config',
      );
    }
    const client = config.testnet
      ? HederaClient.forTestnet()
      : HederaClient.forMainnet();
    const key = config.operatorKey.startsWith('0x')
      ? PrivateKey.fromStringECDSA(config.operatorKey.slice(2))
      : PrivateKey.fromStringECDSA(config.operatorKey);
    client.setOperator(AccountId.fromString(config.operatorId), key);
    _hederaClient = client;
    return client;
  }

  return Method.toServer(chargeMethod, {
    request({ request }) {
      return {
        ...request,
        chainId: request.chainId ?? chainId,
        recipient: request.recipient ?? config.recipient,
        currency: request.currency ?? DEFAULT_TOKEN_ID[chainId],
      };
    },

    async verify({ credential }) {
      const payload = credential.payload;

      // ── Dispatch on credential type ──────────────────────────────
      if (payload.type === 'transaction') {
        return verifyPullMode(credential, config, store, serverId, getHederaClient);
      }

      // ── Push mode: verify via Mirror Node ────────────────────────
      return verifyPushMode(credential, config, store, serverId, maxRetries, retryDelay);
    },
  });
}

// ─── Push mode verification (existing Mirror Node path) ───────────

async function verifyPushMode(
  credential: any,
  config: HederaChargeServerOptions,
  store: Store.Store,
  serverId: string,
  maxRetries: number,
  retryDelay: number,
) {
  const { transactionId } = credential.payload;
  const { amount, recipient } = credential.challenge.request;
  // chainId may live at top level (raw request) or inside methodDetails
  // (after the schema z.transform moves it there for the wire format).
  const chainId =
    credential.challenge.request.chainId ??
    credential.challenge.request.methodDetails?.chainId;
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

  // ── 4. Verify token transfers (amount + recipient + splits) ──
  const tokenTransfers: {
    token_id: string;
    account: string;
    amount: number;
  }[] = tx.token_transfers ?? [];

  const splits = (credential.challenge.request as any).splits as
    Array<{recipient: string; amount: string; memo?: string}> | undefined;

  // Calculate expected primary recipient amount
  const primaryAmount = splits?.length
    ? BigInt(amount) - splits.reduce((sum, s) => sum + BigInt(s.amount), 0n)
    : BigInt(amount);

  // Verify primary recipient credit
  const primaryCredit = tokenTransfers.find(
    (t) =>
      t.token_id === tokenId &&
      t.account === recipient &&
      BigInt(t.amount) >= primaryAmount,
  );

  if (!primaryCredit) {
    throw new Errors.VerificationFailedError({
      reason: `No matching token transfer: expected ${primaryAmount} of ${tokenId} to ${recipient}`,
    });
  }

  // Verify each split recipient credit
  if (splits?.length) {
    for (const split of splits) {
      const splitCredit = tokenTransfers.find(
        (t) =>
          t.token_id === tokenId &&
          t.account === split.recipient &&
          BigInt(t.amount) >= BigInt(split.amount),
      );

      if (!splitCredit) {
        throw new Errors.VerificationFailedError({
          reason: `No matching split transfer: expected ${split.amount} of ${tokenId} to ${split.recipient}`,
        });
      }
    }
  }

  // ── 5. Mark as used ──────────────────────────────────────────
  await store.put(storeKey, Date.now());

  return Receipt.from({
    method: 'hedera',
    reference: transactionId,
    status: 'success',
    timestamp: new Date().toISOString(),
  });
}

// ─── Pull mode verification (server submits client-signed tx) ─────

async function verifyPullMode(
  credential: any,
  config: HederaChargeServerOptions,
  store: Store.Store,
  serverId: string,
  getHederaClient: () => InstanceType<typeof HederaClient>,
) {
  const { transaction: base64Tx } = credential.payload;

  // ── 1. Decode the base64 transaction bytes ───────────────────
  const txBytes = Buffer.from(base64Tx, 'base64');
  const tx = Transaction.fromBytes(txBytes);

  // ── 2. Verify the memo contains valid Attribution challenge binding ──
  const memo = (tx as any).transactionMemo ?? '';
  if (!memo || !memo.startsWith('0x')) {
    throw new Errors.VerificationFailedError({
      reason: 'Transaction memo is not a valid MPP attribution memo',
    });
  }

  const memoHex = memo as `0x${string}`;

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

  // ── 3. Idempotency: hash the tx bytes to prevent replay ──────
  const txHash = Buffer.from(txBytes).toString('hex').slice(0, 64);
  const preStoreKey = `hedera:charge:pull:${txHash}`;
  const preSeen = await store.get(preStoreKey);
  if (preSeen !== null) {
    throw new Errors.VerificationFailedError({
      reason: 'Transaction bytes already submitted',
    });
  }
  await store.put(preStoreKey, Date.now());

  // ── 4. Submit to Hedera network ──────────────────────────────
  const client = getHederaClient();
  let response;
  try {
    response = await tx.execute(client);
  } catch (e: any) {
    // Release the pre-reservation on submission failure
    await store.delete(preStoreKey);
    throw new Errors.VerificationFailedError({
      reason: `Hedera transaction submission failed: ${e.message}`,
    });
  }

  const txReceipt = await response.getReceipt(client);

  if (txReceipt.status.toString() !== 'SUCCESS') {
    throw new Errors.VerificationFailedError({
      reason: `Hedera transaction failed: ${txReceipt.status}`,
    });
  }

  const transactionId = response.transactionId.toString();

  // ── 5. Verify transfer amounts via Mirror Node ────────────────
  const { amount, chainId: rawChainId, recipient } = credential.challenge.request;
  const chainId = rawChainId ?? credential.challenge.request.methodDetails?.chainId;
  const tokenId = DEFAULT_TOKEN_ID[chainId];
  const mirrorNodeUrl = config.mirrorNodeUrl ?? resolveMirrorNode(chainId);
  const urlTxId = formatTxIdForMirrorNode(transactionId);

  const mirrorTx = await fetchTransaction(mirrorNodeUrl, urlTxId, 10, 2000);

  const tokenTransfers: { token_id: string; account: string; amount: number }[] =
    mirrorTx.token_transfers ?? [];

  const splits = (credential.challenge.request as any).splits as
    Array<{ recipient: string; amount: string }> | undefined;

  const primaryAmount = splits?.length
    ? BigInt(amount) - splits.reduce((sum: bigint, s: any) => sum + BigInt(s.amount), 0n)
    : BigInt(amount);

  const primaryCredit = tokenTransfers.find(
    (t) =>
      t.token_id === tokenId &&
      t.account === recipient &&
      BigInt(t.amount) >= primaryAmount,
  );

  if (!primaryCredit) {
    throw new Errors.VerificationFailedError({
      reason: `Pull mode: no matching token transfer for ${primaryAmount} of ${tokenId} to ${recipient}`,
    });
  }

  if (splits?.length) {
    for (const split of splits) {
      const splitCredit = tokenTransfers.find(
        (t) =>
          t.token_id === tokenId &&
          t.account === split.recipient &&
          BigInt(t.amount) >= BigInt(split.amount),
      );
      if (!splitCredit) {
        throw new Errors.VerificationFailedError({
          reason: `Pull mode: no matching split transfer for ${split.amount} to ${split.recipient}`,
        });
      }
    }
  }

  // ── 6. Mark transaction ID as used ────────────────────────────
  const storeKey = `hedera:charge:${transactionId}`;
  await store.put(storeKey, Date.now());

  return Receipt.from({
    method: 'hedera',
    reference: transactionId,
    status: 'success',
    timestamp: new Date().toISOString(),
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
