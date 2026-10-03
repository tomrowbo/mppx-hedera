/**
 * Hedera chain constants for the mppx-hedera MPP plugin.
 *
 * Testnet USDC: 0.0.5449 (long-zero EVM: 0x...1549), 6 decimals
 * Mainnet USDC: 0.0.456858 (long-zero EVM: 0x...06f89a), 6 decimals, Circle native
 * Escrow contract: HederaStreamChannel.sol deployed on both networks.
 */

import { hederaTestnet, hederaMainnet } from './internal.js';

// ─── USDC on Hedera (HTS token exposed as ERC-20 via HIP-218) ─────
// Using 0.0.5449 (testnet USDC, 212 USDC available, verified 2026-04-11)
/**
 * EVM alias of Circle's testnet USDC, the same token `USDC_TOKEN_ID_TESTNET` names.
 *
 * These two have to denote the same token. Until 0.3.1 they did not: 0.3.0 moved the native
 * id to Circle's `0.0.429274` and left this alias on `0.0.5449`, so the EVM paths and the
 * native paths of one library were charging different tokens. It surfaced through the Agent
 * Kit plugin, which validates a 402 challenge's currency against this constant and so refused
 * every charge a correctly configured server advertised.
 */
export const USDC_TESTNET = '0x0000000000000000000000000000000000068cda' as const; // 0.0.429274
export const USDC_MAINNET = '0x000000000000000000000000000000000006f89a' as const; // 0.0.456858
export const USDC_DECIMALS = 6;

// ─── HederaStreamChannel escrow contract ───────────────────────────
// Deployed on both testnet and mainnet
export const HEDERA_STREAM_CHANNEL_TESTNET =
  '0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE' as const; // Deployed 2026-04-28, fully verified on Sourcify, InvalidToken custom error
export const HEDERA_STREAM_CHANNEL_MAINNET =
  '0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE' as const; // Deployed 2026-04-28, fully verified on Sourcify, InvalidToken custom error

/** ABI for the HederaStreamChannel escrow contract. */
export const HEDERA_STREAM_CHANNEL_ABI = [
  {
    name: 'open',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'payee', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'deposit', type: 'uint128' },
      { name: 'salt', type: 'bytes32' },
      { name: 'authorizedSigner', type: 'address' },
    ],
    outputs: [{ name: 'channelId', type: 'bytes32' }],
  },
  {
    name: 'settle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'cumulativeAmount', type: 'uint128' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'topUp',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'additionalDeposit', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'close',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'cumulativeAmount', type: 'uint128' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'requestClose',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getChannel',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'finalized', type: 'bool' },
          { name: 'closeRequestedAt', type: 'uint64' },
          { name: 'payer', type: 'address' },
          { name: 'payee', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'authorizedSigner', type: 'address' },
          { name: 'deposit', type: 'uint128' },
          { name: 'settled', type: 'uint128' },
        ],
      },
    ],
  },
  {
    name: 'computeChannelId',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'payer', type: 'address' },
      { name: 'payee', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'authorizedSigner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'getVoucherDigest',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'cumulativeAmount', type: 'uint128' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'domainSeparator',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'VOUCHER_TYPEHASH',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'CLOSE_GRACE_PERIOD',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    name: 'ChannelOpened',
    type: 'event',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'authorizedSigner', type: 'address', indexed: false },
      { name: 'salt', type: 'bytes32', indexed: false },
      { name: 'deposit', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Settled',
    type: 'event',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'cumulativeAmount', type: 'uint256', indexed: false },
      { name: 'deltaPaid', type: 'uint256', indexed: false },
      { name: 'newSettled', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ChannelClosed',
    type: 'event',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'settledToPayee', type: 'uint256', indexed: false },
      { name: 'refundedToPayer', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'TopUp',
    type: 'event',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'additionalDeposit', type: 'uint256', indexed: false },
      { name: 'newDeposit', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'CloseRequested',
    type: 'event',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'closeGraceEnd', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'CloseRequestCancelled',
    type: 'event',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
    ],
  },
  {
    name: 'ChannelExpired',
    type: 'event',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
    ],
  },
  {
    name: 'associateSelf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: 'responseCode', type: 'int256' }],
  },
  {
    name: 'getChannelsBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'channelIds', type: 'bytes32[]' }],
    outputs: [{
      name: '',
      type: 'tuple[]',
      components: [
        { name: 'finalized', type: 'bool' },
        { name: 'closeRequestedAt', type: 'uint64' },
        { name: 'payer', type: 'address' },
        { name: 'payee', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'authorizedSigner', type: 'address' },
        { name: 'deposit', type: 'uint128' },
        { name: 'settled', type: 'uint128' },
      ],
    }],
  },
] as const;

/** EIP-712 domain name for session voucher signatures. */
export const VOUCHER_DOMAIN_NAME = 'Hedera Stream Channel';
/** EIP-712 domain version for session voucher signatures. */
export const VOUCHER_DOMAIN_VERSION = '1';

/** EIP-712 type definition for `Voucher` typed data. */
export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'channelId', type: 'bytes32' },
    { name: 'cumulativeAmount', type: 'uint128' },
  ],
} as const;

/** EIP-712 type definition for `TransferWithAuthorization` typed data. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** USDC address by Hedera chainId (testnet/mainnet). */
export const DEFAULT_CURRENCY: Record<number, `0x${string}`> = {
  [hederaTestnet.id]: USDC_TESTNET,
  [hederaMainnet.id]: USDC_MAINNET,
};

/** HederaStreamChannel escrow address by Hedera chainId (testnet/mainnet). */
export const DEFAULT_ESCROW: Record<number, `0x${string}`> = {
  [hederaTestnet.id]: HEDERA_STREAM_CHANNEL_TESTNET,
  [hederaMainnet.id]: HEDERA_STREAM_CHANNEL_MAINNET,
};

// ─── Mirror Node REST API ────────────────────────────────────────
export const MIRROR_NODE_TESTNET = 'https://testnet.mirrornode.hedera.com' as const;
export const MIRROR_NODE_MAINNET = 'https://mainnet.mirrornode.hedera.com' as const;

export const DEFAULT_MIRROR_NODE: Record<number, string> = {
  [hederaTestnet.id]: MIRROR_NODE_TESTNET,
  [hederaMainnet.id]: MIRROR_NODE_MAINNET,
};

// ─── Hedera-native token IDs (shard.realm.num) ──────────────────
/**
 * Circle's own USDC on Hedera testnet, and the token `https://faucet.circle.com`
 * dispenses when you pick Hedera Testnet.
 *
 * Up to 0.2.3 this was `0.0.5449`, a different token that is also named "USD Coin",
 * also has symbol USDC and also has 6 decimals — only its treasury differs
 * (`0.0.3923` vs Circle's `0.0.5176`). Nothing was wrong with it except that it is
 * not the one anybody can obtain: there is no faucet for it, so getting any meant
 * swapping HBAR on SaucerSwap, while Circle's faucet hands out the other one. A
 * server settling the unobtainable token rejects a buyer who followed Circle's
 * documentation, with an `insufficient_balance` that names a token they are
 * holding.
 */
export const USDC_TOKEN_ID_TESTNET = '0.0.429274' as const;
/** Circle's USDC on Hedera mainnet. */
export const USDC_TOKEN_ID_MAINNET = '0.0.456858' as const;

export const DEFAULT_TOKEN_ID: Record<number, string> = {
  [hederaTestnet.id]: USDC_TOKEN_ID_TESTNET,
  [hederaMainnet.id]: USDC_TOKEN_ID_MAINNET,
};
