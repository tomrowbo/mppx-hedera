/**
 * mppx-hedera — Native Machine Payments Protocol method for Hedera.
 *
 * Forked from @abstract-foundation/mpp (MIT) with charge layer ported
 * from @stablecoin.xyz/radius-mpp (MIT). Both credited in README.
 */

// Schemas (shared between client + server)
export { chargeMethod, sessionMethod } from './client/methods.js';

// Attribution memo encoding (same layout as Tempo)
export * as Attribution from './attribution.js';

// Chain definitions
export { hederaTestnet, hederaMainnet } from './internal.js';

// Constants
export {
  USDC_TESTNET,
  USDC_MAINNET,
  USDC_DECIMALS,
  HEDERA_STREAM_CHANNEL_TESTNET,
  HEDERA_STREAM_CHANNEL_MAINNET,
  DEFAULT_CURRENCY,
  DEFAULT_ESCROW,
  VOUCHER_DOMAIN_NAME,
  VOUCHER_DOMAIN_VERSION,
  VOUCHER_TYPES,
  HEDERA_STREAM_CHANNEL_ABI,
} from './constants.js';
