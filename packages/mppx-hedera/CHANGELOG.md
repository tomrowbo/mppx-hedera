# mppx-hedera

## 0.2.3

### Fixed

- **`charge()` now honours `recipient` and `currency` configured at method
  construction.** `hedera.charge({ recipient })` — the usage shown in the README
  and in the function's own docstring — was rejected with a Zod validation error
  (`recipient: expected string`) on mppx 0.10, because request defaults are merged
  before schema validation while the `request()` hook runs after it. `charge()`
  supplied those fields from the hook alone, so validation failed before the hook
  could fill them in. `session()` already used `defaults` and was unaffected.

  Passing `recipient` per charge still works and still overrides the configured
  value, so this is additive — no change is required to existing code.

- Corrected the `charge()` docstring, which omitted the required `recipient`
  option and the `realm` argument, and noted that `secretKey` must be at least
  32 bytes.

### Testing

- Added `test/charge-defaults.test.ts` covering construction-time configuration.
  Every previous test passed `recipient` to both `hedera.charge()` and the
  `mppx.charge()` call, so the documented usage was never exercised — which is
  why this shipped broken. The new tests fail against the old code.
- Verified against both mppx 0.5.12 and mppx 0.10.1: 121 tests pass on each.


## 0.2.0

### Breaking changes
- Charge client now uses `@hiero-ledger/sdk` (native Hedera transactions) instead of viem ERC-20 transfers
- Charge credential payload changed from `{ txHash }` to `{ transactionId, type: "hash" }` or `{ transaction, type: "transaction" }`
- Client options changed: `walletClient` replaced with `operatorId` + `operatorKey` + `network`
- `@hiero-ledger/sdk` is now a peer dependency

### New features
- **Attribution memo** — challenge-bound replay protection using same 32-byte layout as Tempo
- **Pull mode** — client signs, server broadcasts (`type: "transaction"`)
- **Splits** — up to 10 recipients per charge, atomic multi-transfer
- **SSE transport** — metered streaming for session payments (LLM token billing)
- **externalId** — merchant reference field in charge request
- **Server defaults** — `request()` hook enriches challenges with chainId, recipient, currency
- **Dependency injection** — session server accepts `getClients` for testing

### Testing
- 217 tests: 45 vitest (mocked) + 144 legacy unit + 19 testnet E2E + 9 mainnet E2E
- Full mppx HTTP round-trip tests (Mppx.create → 402 → credential → verify → 200)
- Concurrency tests (50 parallel vouchers, race conditions)
- Real Hedera mainnet E2E with Circle USDC, verified on Hashscan

## 0.1.4

- Redeployed contracts with full Sourcify verification (both testnet + mainnet)
- Same deterministic address on both networks: `0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE`

## 0.1.3

- Fixed contract addresses in published package

## 0.1.2

- Mainnet support: deployed HederaStreamChannel + associated Circle USDC
- ERC-20 approve works via EVM with `gas: 1_000_000n`
- Integration guide added to README

## 0.1.1

- Mainnet contract deployed + Circle USDC associated
- Cleaned README for production

## 0.1.0

- Initial release: charge + session intents on Hedera testnet
- Forked from @abstract-foundation/mpp (session) + @stablecoin.xyz/radius-mpp (charge)
- Deployed HederaStreamChannel escrow contract
- Published to npm
