# mppx-hedera Test Plan

Tests needed to match Tempo/Solana quality bar for MPP adoption.
Organized by file — each maps to one test file.

---

## 1. `test/attribution.test.mjs` (18 tests)

Pure unit tests — no network, no mocks needed.

### encode()
- [ ] Returns 66-char hex string (32 bytes)
- [ ] Starts with MPP tag (keccak256("mpp")[0..4]) + version 0x01
- [ ] Server fingerprint at bytes 5-14 matches keccak256(serverId)[0..10]
- [ ] Client fingerprint at bytes 15-24 matches keccak256(clientId)[0..10]
- [ ] Anonymous client (no clientId) has zero bytes at 15-24
- [ ] Challenge nonce at bytes 25-31 matches keccak256(challengeId)[0..7]
- [ ] Deterministic — same inputs always produce same output
- [ ] Different challengeIds produce different nonces

### isMppMemo()
- [ ] Returns true for valid encoded memo
- [ ] Returns false for zero-filled 32 bytes
- [ ] Returns false for arbitrary hex
- [ ] Returns false for short string
- [ ] Returns false for wrong version byte
- [ ] Handles mixed case hex

### verifyServer()
- [ ] Returns true for matching serverId
- [ ] Returns false for wrong serverId
- [ ] Returns false for non-MPP memo

### verifyChallengeBinding()
- [ ] Returns true for matching challengeId
- [ ] Returns false for wrong challengeId
- [ ] Returns false for non-MPP memo

---

## 2. `test/schema.test.mjs` (20 tests)

Schema validation — tests chargeMethod and sessionMethod schemas.

### Charge request schema
- [ ] Accepts valid request (amount, currency, decimals, recipient)
- [ ] Accepts request with optional fields (chainId, description, externalId)
- [ ] Accepts request with splits (1 split)
- [ ] Accepts request with max splits (10 splits)
- [ ] Rejects missing amount
- [ ] Rejects missing currency
- [ ] Rejects missing decimals
- [ ] Rejects missing recipient
- [ ] Transforms amount via parseUnits correctly
- [ ] Transforms split amounts via parseUnits
- [ ] Passes through externalId

### Charge credential payload schema
- [ ] Accepts { type: "hash", transactionId: "0.0.123@456.789" }
- [ ] Accepts { type: "transaction", transaction: "base64..." }
- [ ] Rejects unknown type
- [ ] Rejects missing transactionId on hash type
- [ ] Rejects missing transaction on transaction type

### Session credential payload schema
- [ ] Accepts open action
- [ ] Accepts voucher action
- [ ] Accepts close action
- [ ] Accepts topUp action

---

## 3. `test/server-charge.test.mjs` (30 tests)

Server charge verification — mocked Mirror Node responses, no real network.

### Push mode verification
- [ ] Accepts valid transaction with correct memo + transfers
- [ ] Rejects transaction with non-SUCCESS result
- [ ] Rejects transaction with invalid MPP memo
- [ ] Rejects transaction with wrong server fingerprint
- [ ] Rejects transaction with wrong challenge nonce
- [ ] Rejects transaction with wrong recipient in token_transfers
- [ ] Rejects transaction with wrong token_id in token_transfers
- [ ] Rejects transaction with insufficient amount
- [ ] Rejects transaction with empty token_transfers
- [ ] Rejects transaction with missing memo_base64

### Replay protection
- [ ] Rejects replayed transaction ID (same txId used twice)
- [ ] Accepts different transaction IDs for same challenge
- [ ] Store key format is `hedera:charge:{transactionId}`

### Splits verification
- [ ] Accepts transaction with correct primary + split transfers
- [ ] Rejects when primary recipient amount is wrong
- [ ] Rejects when split recipient is missing
- [ ] Rejects when split amount is insufficient

### Pull mode verification
- [ ] Accepts valid serialized transaction with correct memo
- [ ] Rejects transaction with invalid memo
- [ ] Rejects transaction with wrong server fingerprint
- [ ] Rejects transaction with wrong challenge binding

### request() hook
- [ ] Fills in default chainId from testnet config
- [ ] Fills in default recipient from config
- [ ] Fills in default currency from config
- [ ] Preserves explicit chainId from request
- [ ] Preserves explicit recipient from request

### Error types
- [ ] Throws VerificationFailedError (not generic Error)
- [ ] Error includes descriptive reason string

---

## 4. `test/server-session.test.mjs` (30 tests)

Session channel lifecycle — mocked chain, in-memory store.

### Channel open
- [ ] Accepts valid open credential with on-chain match
- [ ] Rejects open when channel not funded on-chain
- [ ] Rejects open when channel is finalized
- [ ] Rejects open when payee doesn't match recipient
- [ ] Rejects open when token doesn't match currency
- [ ] Rejects open with invalid voucher signature
- [ ] Rejects open when cumulativeAmount exceeds deposit
- [ ] Rejects duplicate open with same salt/channelId (from Abstract)

### Voucher
- [ ] Accepts voucher with higher cumulative amount
- [ ] Rejects voucher with lower/equal cumulative amount (returns existing receipt)
- [ ] Rejects voucher exceeding deposit
- [ ] Rejects voucher with invalid signature
- [ ] Rejects voucher for unknown channel
- [ ] Rejects voucher for finalized channel
- [ ] Enforces minVoucherDelta

### TopUp
- [ ] Accepts topUp when deposit increased on-chain
- [ ] Rejects topUp when deposit didn't increase
- [ ] Rejects topUp for unknown channel

### Close
- [ ] Accepts close with valid final voucher
- [ ] Rejects close below spent amount
- [ ] Rejects close exceeding deposit
- [ ] Rejects close with invalid signature
- [ ] Rejects close for already finalized channel

### Force-close lifecycle (from Abstract)
- [ ] requestClose sets closeRequestedAt on channel
- [ ] Withdraw before grace period is rejected
- [ ] Withdraw after grace period succeeds

### Incremental settlement (from Abstract)
- [ ] Two settles with increasing cumulative (20 then 50) — payee gets 50 total, not 70
- [ ] Close with zero amount = full refund to payer

### Channel state
- [ ] Spent increases with each voucher
- [ ] Units count increases with each voucher
- [ ] highestVoucherAmount tracks correctly
- [ ] finalized set to true after close

---

## 5. `test/sse.test.mjs` (15 tests)

SSE transport — in-memory store, no network.

### serve()
- [ ] Emits correct number of message events
- [ ] Emits payment-receipt on stream completion
- [ ] Receipt contains correct spent, units, method, intent
- [ ] Deducts tickCost from channel per chunk
- [ ] Emits payment-need-voucher when balance exhausted
- [ ] Resumes after voucher top-up
- [ ] Handles abort signal (stops stream)
- [ ] Handles empty source (just receipt, no messages)
- [ ] Handles source that throws (error propagation)
- [ ] Channel store updated correctly after streaming

### toResponse()
- [ ] Sets Content-Type: text/event-stream
- [ ] Sets Cache-Control: no-cache
- [ ] Sets Connection: keep-alive

### parseEvent()
- [ ] Parses message events
- [ ] Parses payment-need-voucher events
- [ ] Parses payment-receipt events

---

## 6. `test/exports.test.mjs` (12 tests)

Barrel export verification — no network.

### Root index (mppx-hedera)
- [ ] Exports chargeMethod
- [ ] Exports sessionMethod
- [ ] Exports Attribution namespace
- [ ] Exports hederaTestnet / hederaMainnet chains
- [ ] Exports USDC constants
- [ ] Exports DEFAULT_CURRENCY / DEFAULT_ESCROW

### Client index (mppx-hedera/client)
- [ ] Exports charge function
- [ ] Exports hederaCharge (alias)
- [ ] Exports hederaSession
- [ ] Exports chargeMethod / sessionMethod

### Server index (mppx-hedera/server)
- [ ] Exports hedera namespace with charge + session
- [ ] Exports Sse namespace

---

## 7. `test/internal.test.mjs` (10 tests)

Internal utilities — pure unit tests.

### resolveChain()
- [ ] Returns hederaTestnet for chainId 296
- [ ] Returns hederaMainnet for chainId 295
- [ ] Throws for unknown chainId

### resolveMirrorNode()
- [ ] Returns testnet URL for chainId 296
- [ ] Returns mainnet URL for chainId 295
- [ ] Throws for unknown chainId

### formatTxIdForMirrorNode()
- [ ] Converts "0.0.123@456.789" → "0.0.123-456-789"
- [ ] Handles real transaction IDs correctly

### assertUint128()
- [ ] Passes for 0
- [ ] Passes for max uint128
- [ ] Throws for negative
- [ ] Throws for > uint128

---

## 8. `test/constants.test.mjs` (8 tests)

Constants validation.

- [ ] USDC_TESTNET is correct address format
- [ ] USDC_MAINNET is correct address format
- [ ] USDC_TOKEN_ID_TESTNET is "0.0.5449"
- [ ] USDC_TOKEN_ID_MAINNET is "0.0.456858"
- [ ] DEFAULT_CURRENCY maps 296 → testnet USDC, 295 → mainnet USDC
- [ ] DEFAULT_ESCROW maps both chains to contract address
- [ ] DEFAULT_MIRROR_NODE maps both chains
- [ ] DEFAULT_TOKEN_ID maps both chains

---

## 9. `test/integration.test.mjs` (existing — keep as-is)

Real Hedera testnet E2E tests. Already passing 31/31.

---

## Summary

| File | Tests | Type |
|------|-------|------|
| attribution.test.mjs | 18 | Pure unit |
| schema.test.mjs | 20 | Pure unit |
| server-charge.test.mjs | 30 | Mocked unit |
| server-session.test.mjs | 30 | Mocked unit |
| sse.test.mjs | 15 | In-memory unit |
| exports.test.mjs | 12 | Pure unit |
| internal.test.mjs | 10 | Pure unit |
| constants.test.mjs | 8 | Pure unit |
| integration.test.mjs | 31 | Real testnet E2E |

**Total: 174 tests** (143 new + 31 existing)
