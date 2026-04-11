/**
 * mppx-hedera/client — charge intent
 *
 * Client-side: signs and broadcasts an ERC-20 transfer on Hedera via Hashio,
 * then returns the txHash as the Credential payload.
 *
 * Ported from @stablecoin.xyz/radius-mpp (MIT) with Hedera chain config.
 * Uses plain ERC-20 transfer() — not ERC-3009 (HTS tokens don't support it).
 */

import { Credential, type Method } from 'mppx';
import {
  createPublicClient,
  http,
  type Account,
  type Chain,
  type Transport,
  type WalletClient,
  encodeFunctionData,
  erc20Abi,
} from 'viem';
import { chargeMethod } from './methods.js';
import { resolveChain } from '../internal.js';
import { DEFAULT_CURRENCY } from '../constants.js';

export interface HederaChargeClientOptions {
  /** A viem WalletClient with an account attached (e.g. via privateKeyToAccount). */
  walletClient: WalletClient<Transport, Chain, Account>;
  /** Number of block confirmations to wait. Defaults to 1. */
  confirmations?: number;
}

/**
 * Creates a client-side Hedera charge method that signs a plain ERC-20
 * transfer and returns the txHash as the credential.
 */
export function charge(config: HederaChargeClientOptions) {
  const { walletClient, confirmations = 1 } = config;

  return Method.toClient(chargeMethod, {
    async createCredential({ challenge }) {
      const { amount, chainId, recipient } = challenge.request;
      const token = challenge.request.token ?? DEFAULT_CURRENCY[chainId];
      if (!token) throw new Error(`No USDC token configured for chainId ${chainId}`);

      const chain = resolveChain(chainId);
      const publicClient = createPublicClient({
        chain,
        transport: http(chain.rpcUrls.default.http[0]),
      });

      // Build ERC-20 transfer(recipient, amount) calldata
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [recipient as `0x${string}`, BigInt(amount)],
      });

      // Submit with explicit gas — Hashio underestimates for HTS precompile calls
      const txHash = await walletClient.sendTransaction({
        to: token as `0x${string}`,
        data,
        chain,
        gas: 500_000n,
      });

      await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations,
      });

      return Credential.serialize({
        challenge,
        payload: { txHash },
      });
    },
  });
}
