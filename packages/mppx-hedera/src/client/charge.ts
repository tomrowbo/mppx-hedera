/**
 * mppx-hedera/client — charge intent (native Hedera transaction)
 *
 * Client-side: builds a native Hedera TransferTransaction with an MPP
 * attribution memo (challenge-bound), submits it via the Hedera SDK,
 * and returns the transaction ID as the Credential payload.
 *
 * The attribution memo uses the same 32-byte layout as Tempo's Attribution.ts,
 * ensuring compatibility with the mppx ecosystem's challenge-binding verification.
 */

import { Credential, Method } from 'mppx';
import {
  Client as HederaClient,
  TransferTransaction,
  AccountId,
  TokenId,
  PrivateKey,
} from '@hashgraph/sdk';
import { chargeMethod } from './methods.js';
import { DEFAULT_TOKEN_ID } from '../constants.js';
import * as Attribution from '../attribution.js';

export interface HederaChargeClientOptions {
  /** Hedera account ID of the payer, e.g. "0.0.12345". */
  operatorId: string;
  /** Private key (hex or DER-encoded) for the operator account. */
  operatorKey: string;
  /** Network: 'testnet' or 'mainnet'. Defaults to 'testnet'. */
  network?: 'testnet' | 'mainnet';
  /** Optional client identity for the attribution memo. */
  clientId?: string;
}

/**
 * Creates a client-side Hedera charge method that submits a native
 * token transfer with an MPP attribution memo.
 *
 * @example
 * ```ts
 * import { charge } from 'mppx-hedera/client'
 *
 * const hederaCharge = charge({
 *   operatorId: '0.0.12345',
 *   operatorKey: '0x...',
 *   network: 'testnet',
 * })
 * ```
 */
export function charge(config: HederaChargeClientOptions) {
  const {
    operatorId,
    operatorKey,
    network = 'testnet',
    clientId,
  } = config;

  // Parse key — supports hex (with or without 0x prefix) and DER
  const key = operatorKey.startsWith('0x')
    ? PrivateKey.fromStringECDSA(operatorKey.slice(2))
    : PrivateKey.fromStringECDSA(operatorKey);

  return Method.toClient(chargeMethod, {
    async createCredential({ challenge }) {
      const req = challenge.request as any;
      const chainId = req.methodDetails?.chainId ?? (network === 'mainnet' ? 295 : 296);

      // Resolve Hedera-native token ID
      const tokenId = DEFAULT_TOKEN_ID[chainId];
      if (!tokenId) throw new Error(`No USDC token configured for chainId ${chainId}`);

      const amount = Number(BigInt(req.amount));
      const recipient = req.recipient as string; // expects "0.0.XXXX" format

      // Build Attribution memo (same layout as Tempo)
      const serverId = (challenge as any).realm ?? 'hedera-mpp';
      const memo = Attribution.encode({
        challengeId: challenge.id as string,
        clientId,
        serverId,
      });

      // Create Hedera client
      const client = network === 'mainnet'
        ? HederaClient.forMainnet()
        : HederaClient.forTestnet();
      client.setOperator(AccountId.fromString(operatorId), key);

      // Build and execute native TransferTransaction with memo
      const tx = new TransferTransaction()
        .addTokenTransfer(
          TokenId.fromString(tokenId),
          AccountId.fromString(operatorId),
          -amount,
        )
        .addTokenTransfer(
          TokenId.fromString(tokenId),
          AccountId.fromString(recipient),
          amount,
        )
        .setTransactionMemo(memo)
        .freezeWith(client);

      const response = await tx.execute(client);
      const receipt = await response.getReceipt(client);

      if (receipt.status.toString() !== 'SUCCESS') {
        throw new Error(`Hedera transaction failed: ${receipt.status}`);
      }

      const transactionId = response.transactionId.toString();

      client.close();

      return Credential.serialize({
        challenge,
        payload: { transactionId, type: 'hash' as const },
        source: `did:pkh:hedera:${network}:${operatorId}`,
      });
    },
  });
}

// Re-export with legacy name for backward compat
export { charge as hederaCharge };
