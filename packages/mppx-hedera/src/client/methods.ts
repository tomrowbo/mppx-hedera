/**
 * Hedera MPP method definitions (client + server share the same schema objects).
 */

import { Method, z } from 'mppx';
import { parseUnits } from 'viem';

/**
 * Hedera charge intent — one-time USDC transfer via native Hedera transaction.
 *
 * The credential payload carries the Hedera transaction ID so the server can
 * verify the transfer and challenge-bound memo via the Mirror Node REST API.
 */
export const chargeMethod = Method.from({
  name: 'hedera',
  intent: 'charge',
  schema: {
    credential: {
      payload: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('hash'),
          transactionId: z.string(),
        }),
        z.object({
          type: z.literal('transaction'),
          transaction: z.string(), // base64-encoded serialized signed Hedera tx bytes
        }),
      ]),
    },
    request: z.pipe(
      z.object({
        amount: z.amount(),
        currency: z.string(),
        decimals: z.number(),
        recipient: z.string(),
        chainId: z.optional(z.number()),
        description: z.optional(z.string()),
        externalId: z.optional(z.string()),
        splits: z.optional(z.array(z.object({
          recipient: z.string(),
          amount: z.amount(),
          memo: z.optional(z.string()),
        })).min(1).max(10)),
      }),
      z.transform(({ amount, decimals, chainId, externalId, splits, ...rest }) => ({
        ...rest,
        amount: parseUnits(amount, decimals).toString(),
        ...(externalId !== undefined && { externalId }),
        ...(chainId !== undefined
          ? { methodDetails: { chainId } }
          : {}),
        ...(splits !== undefined && {
          splits: splits.map(s => ({
            ...s,
            amount: parseUnits(s.amount, decimals).toString(),
          })),
        }),
      })),
    ),
  },
});

/**
 * Hedera session intent — payment channels backed by HederaStreamChannel.
 */
export const sessionMethod = Method.from({
  name: 'hedera',
  intent: 'session',
  schema: {
    credential: {
      payload: z.discriminatedUnion('action', [
        z.object({
          action: z.literal('open'),
          channelId: z.hash(),
          cumulativeAmount: z.amount(),
          signature: z.signature(),
          txHash: z.hash(),
          authorizedSigner: z.optional(z.string()),
        }),
        z.object({
          action: z.literal('topUp'),
          channelId: z.hash(),
          additionalDeposit: z.amount(),
          txHash: z.hash(),
        }),
        z.object({
          action: z.literal('voucher'),
          channelId: z.hash(),
          cumulativeAmount: z.amount(),
          signature: z.signature(),
        }),
        z.object({
          action: z.literal('close'),
          channelId: z.hash(),
          cumulativeAmount: z.amount(),
          signature: z.signature(),
        }),
      ]),
    },
    request: z.pipe(
      z.object({
        amount: z.amount(),
        currency: z.string(),
        decimals: z.number(),
        unitType: z.string(),
        recipient: z.optional(z.string()),
        chainId: z.optional(z.number()),
        channelId: z.optional(z.hash()),
        escrowContract: z.optional(z.string()),
        suggestedDeposit: z.optional(z.amount()),
        minVoucherDelta: z.optional(z.amount()),
      }),
      z.transform(
        ({
          amount,
          decimals,
          suggestedDeposit,
          minVoucherDelta,
          channelId,
          escrowContract,
          chainId,
          ...rest
        }) => ({
          ...rest,
          amount: parseUnits(amount, decimals).toString(),
          ...(suggestedDeposit !== undefined && {
            suggestedDeposit: parseUnits(suggestedDeposit, decimals).toString(),
          }),
          methodDetails: {
            escrowContract,
            ...(channelId !== undefined && { channelId }),
            ...(minVoucherDelta !== undefined && {
              minVoucherDelta: parseUnits(minVoucherDelta, decimals).toString(),
            }),
            ...(chainId !== undefined && { chainId }),
          },
        }),
      ),
    ),
  },
});
