# mppx-hedera

[![npm](https://img.shields.io/npm/v/mppx-hedera)](https://www.npmjs.com/package/mppx-hedera)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Native [Machine Payments Protocol](https://mpp.dev) method for [Hedera](https://hedera.com). Charge and session intents over USDC, settled directly on-chain with no facilitator.

## Install

```bash
npm install mppx-hedera mppx viem @hiero-ledger/sdk
```

`@hiero-ledger/sdk` and `viem` are peer dependencies. The charge intent uses the Hedera SDK for native token transfers. The session intent uses viem for EVM escrow contract interactions.

## Quick start -- Server

### Charge

```ts
import { Mppx } from 'mppx/server'
import { hedera } from 'mppx-hedera/server'

const mppx = Mppx.create({
  methods: [
    hedera.charge({
      serverId: 'api.example.com',
      recipient: '0.0.12345',
      testnet: true,
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY!,
})

export async function handler(request: Request) {
  const result = await mppx.charge({ amount: '10000', description: 'Data query' })(request)
  if (result.status === 402) return result.challenge
  return result.withReceipt(Response.json({ data: '...' }))
}
```

### Session

```ts
import { Mppx } from 'mppx/server'
import { hedera } from 'mppx-hedera/server'
import { privateKeyToAccount } from 'viem/accounts'

const mppx = Mppx.create({
  methods: [
    hedera.session({
      account: privateKeyToAccount('0x...'),
      recipient: '0x...',
      amount: '0.001',
      suggestedDeposit: '1',
      unitType: 'request',
      testnet: true,
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY!,
})
```

### SSE streaming

```ts
import { Sse } from 'mppx-hedera/server'

async function* generateTokens() {
  yield '{"content": "Hello"}'
  yield '{"content": " world"}'
}

const stream = Sse.serve(generateTokens(), {
  store,
  channelId: '0x...',
  challengeId: 'challenge-123',
  tickCost: 1000n,
})

return Sse.toResponse(stream)
```

## Quick start -- Client

### Charge

```ts
import { Mppx } from 'mppx/client'
import { charge } from 'mppx-hedera/client'

const mppx = Mppx.create({
  methods: [
    charge({
      operatorId: '0.0.12345',
      operatorKey: '0x...',
      network: 'testnet',
    }),
  ],
})

const res = await mppx.fetch('/api/data', { method: 'POST' })
```

The client automatically handles the `402 -> sign transfer -> retry` flow.

### Session

```ts
import { Mppx } from 'mppx/client'
import { hederaSession } from 'mppx-hedera/client'
import { privateKeyToAccount } from 'viem/accounts'

const mppx = Mppx.create({
  methods: [
    hederaSession({
      account: privateKeyToAccount('0x...'),
      deposit: '10',
    }),
  ],
})
```

Sessions still use viem because the escrow contract is an EVM smart contract (EIP-712 vouchers, on-chain open/settle/close).

## Payment intents

### Charge flow

One-time payment per request. The client builds a native Hedera `TransferTransaction` with an attribution memo, submits it, and the server verifies via the Mirror Node REST API.

```
Client  ->  POST /resource
Server  ->  402 + WWW-Authenticate: Payment method="hedera"
Client  ->  builds TransferTransaction with attribution memo
Client  ->  executes via @hiero-ledger/sdk (push) or serializes (pull)
Client  ->  retries with Authorization: Payment <credential>
Server  ->  verifies via Mirror Node: memo binding + token transfers
Server  ->  200 + Payment-Receipt header
```

### Session flow

Streaming micropayments via payment channels. One on-chain deposit, unlimited off-chain vouchers, one on-chain settlement.

```
Client  ->  approve USDC + escrow.open()     [1 on-chain tx]
Client  ->  signs EIP-712 voucher per request [off-chain, <1ms]
Server  ->  ecrecover verification            [no RPC, no gas]
...repeat N times...
Server  ->  escrow.close()                   [1 on-chain tx]
```

**N requests = 2 on-chain transactions**, regardless of N.

## Features

### Attribution memo

Every charge transaction includes a 32-byte attribution memo (same layout as Tempo) that binds the payment to a specific challenge. This prevents replay attacks without requiring a facilitator.

```
| Offset | Size | Field                              |
|--------|------|------------------------------------|
| 0..3   | 4    | TAG = keccak256("mpp")[0..3]        |
| 4      | 1    | version (0x01)                     |
| 5..14  | 10   | serverId fingerprint               |
| 15..24 | 10   | clientId fingerprint (or zeros)    |
| 25..31 | 7    | nonce = keccak256(challengeId)[0..6]|
```

### Push and pull modes

**Push** (default): the client executes the transaction and returns the transaction ID. The server verifies via Mirror Node.

**Pull**: the client freezes and signs the transaction, serializes it to base64, and returns the bytes. The server submits the transaction on behalf of the client. Requires `operatorId` and `operatorKey` on the server.

```ts
// Client: pull mode
charge({
  operatorId: '0.0.12345',
  operatorKey: '0x...',
  mode: 'pull',
})

// Server: pull mode requires operator credentials
hedera.charge({
  serverId: 'api.example.com',
  recipient: '0.0.12345',
  testnet: true,
  operatorId: '0.0.99999',
  operatorKey: '0x...',
})
```

### Splits

Distribute a single charge across multiple recipients atomically. The primary recipient receives `amount - sum(splits)`, and each split recipient receives their specified amount.

```ts
const result = await mppx.charge({
  amount: '10000',
  recipient: '0.0.1000',
  splits: [
    { recipient: '0.0.2000', amount: '1000' },
    { recipient: '0.0.3000', amount: '500' },
  ],
})(request)
// 0.0.1000 receives 8500, 0.0.2000 receives 1000, 0.0.3000 receives 500
```

### SSE transport

Metered streaming for session payments. Each chunk yielded by an async iterable is metered against the channel balance. When funds run low, the stream emits a `payment-need-voucher` event and pauses until the client tops up.

Three event types:
- `message` -- application data chunk
- `payment-need-voucher` -- balance exhausted, client should send a new voucher
- `payment-receipt` -- final receipt when the stream completes

Client-side parsing:

```ts
import { Sse } from 'mppx-hedera/server'

for await (const event of Sse.iterateEvents(response)) {
  switch (event.type) {
    case 'message':
      console.log(event.data)
      break
    case 'payment-need-voucher':
      // submit a new voucher
      break
    case 'payment-receipt':
      // stream complete
      break
  }
}
```

## API reference

### Server charge options (`HederaChargeServerOptions`)

| Option | Type | Required | Description |
|---|---|---|---|
| `serverId` | `string` | Yes | Server identity for attribution memo verification |
| `recipient` | `string` | Yes | Hedera account ID of the payment recipient (e.g. `"0.0.12345"`) |
| `testnet` | `boolean` | No | Use testnet (chainId 296). Defaults to `false` (mainnet) |
| `mirrorNodeUrl` | `string` | No | Override Mirror Node REST API base URL |
| `store` | `Store.Store` | No | Pluggable idempotency store. Defaults to in-memory |
| `maxRetries` | `number` | No | Mirror Node poll retries. Default `10` |
| `retryDelay` | `number` | No | Delay between retries in ms. Default `2000` |
| `operatorId` | `string` | No | Server Hedera account ID (required for pull mode) |
| `operatorKey` | `string` | No | Server private key (required for pull mode) |

### Server session options (`HederaSessionServerOptions`)

| Option | Type | Required | Description |
|---|---|---|---|
| `account` | `Account` | Yes | Viem account for broadcasting close/settle transactions |
| `recipient` | `Address` | Yes | Payment recipient EVM address |
| `amount` | `string` | No | Per-request amount (human-readable, e.g. `"0.001"`) |
| `suggestedDeposit` | `string` | No | Suggested deposit for clients (human-readable) |
| `currency` | `Address` | No | Token address. Defaults to USDC for the chain |
| `escrowContract` | `Address` | No | Escrow contract address. Defaults to canonical deployment |
| `testnet` | `boolean` | No | Use testnet (chainId 296). Default `false` |
| `rpcUrl` | `string` | No | Custom JSON-RPC URL |
| `store` | `Store.Store` | No | Channel state store. Defaults to in-memory |
| `getClients` | `function` | No | Client factory for dependency injection (testing) |

### Client charge options (`HederaChargeClientOptions`)

| Option | Type | Required | Description |
|---|---|---|---|
| `operatorId` | `string` | Yes | Hedera account ID of the payer (e.g. `"0.0.12345"`) |
| `operatorKey` | `string` | Yes | Private key (hex, with or without `0x` prefix) |
| `network` | `string` | No | `'testnet'` or `'mainnet'`. Default `'testnet'` |
| `clientId` | `string` | No | Client identity for the attribution memo |
| `mode` | `string` | No | `'push'` (default) or `'pull'` |

### Client session options (`HederaSessionClientOptions`)

| Option | Type | Required | Description |
|---|---|---|---|
| `account` | `Account` | Yes | Viem account for signing vouchers and channel transactions |
| `deposit` | `string` | No | Default deposit amount (human-readable, e.g. `"10"`) |
| `rpcUrl` | `string` | No | Custom RPC URL override |
| `escrowContract` | `Address` | No | Override escrow contract address |
| `onChannelOpened` | `function` | No | Callback after channel opens, before first voucher |

### SSE API (`Sse`)

| Export | Description |
|---|---|
| `Sse.serve(source, options)` | Wraps an `AsyncIterable<string>` with payment metering, returns `ReadableStream` |
| `Sse.toResponse(stream)` | Wraps a `ReadableStream` into an HTTP `Response` with SSE headers |
| `Sse.fromRequest(request)` | Extracts `channelId`, `challengeId`, `tickCost` from Authorization header |
| `Sse.parseEvent(raw)` | Parses a raw SSE event string into a typed `SseEvent` |
| `Sse.isEventStream(response)` | Checks if a `Response` carries an SSE event stream |
| `Sse.iterateEvents(response)` | Async generator that yields parsed `SseEvent` objects from a response body |

## Deployed contracts

| Network | HederaStreamChannel | USDC (HTS) | Chain ID |
|---|---|---|---|
| Testnet | [`0x8Aaf...daE`](https://hashscan.io/testnet/contract/0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE) | `0.0.5449` | 296 |
| Mainnet | [`0x8Aaf...daE`](https://hashscan.io/mainnet/contract/0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE) | `0.0.456858` (Circle) | 295 |

Both contracts are verified on [Hashscan](https://hashscan.io) via Sourcify. Same deterministic address on both networks. The escrow is a port of [Tempo's StreamChannel](https://github.com/tempoxyz/mpp-specs) with the EIP-712 domain set to `"Hedera Stream Channel"`.

## Hedera-specific considerations

### Gas limits

Hashio (Hedera's JSON-RPC relay) underestimates gas for transactions involving the HTS precompile. Set explicit limits for session (EVM) operations:

| Operation | Recommended gas |
|---|---|
| ERC-20 `transfer` | `500_000n` |
| ERC-20 `approve` | `1_000_000n` |
| `escrow.open` / `settle` / `close` | `1_500_000n` |

Charge intents bypass this entirely by using native Hedera `TransferTransaction` via `@hiero-ledger/sdk`.

### HTS token association

Hedera accounts must associate with an HTS token before receiving it. If a charge or session transfer fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`, the recipient must call `TokenAssociateTransaction` first.

### Voucher signing

Session vouchers use EIP-712 typed data with `signTypedData` (raw ECDSA). The escrow contract verifies via `ecrecover` on the raw EIP-712 digest. Domain name: `"Hedera Stream Channel"`, version: `"1"`.

### Mirror Node indexing lag

After a charge transaction reaches consensus, there is a 3-5 second delay before the Mirror Node indexes it. The server charge handler retries automatically (default: 10 retries, 2s interval).

## Testing

```bash
# Unit + integration tests (mocked, no network)
pnpm test

# Watch mode
pnpm test:watch

# Legacy test suite
pnpm test:legacy
```

The test suite includes:

- **Vitest tests** -- mocked mppx HTTP round-trips, concurrency (50 parallel vouchers), SSE edge cases, pull mode, server charge/session verification
- **Legacy unit tests** -- attribution encoding, constants, schemas, exports
- **E2E tests** -- real Hedera testnet + mainnet transactions (requires funded accounts)

## Attribution

Session infrastructure forked from [@abstract-foundation/mpp](https://github.com/Abstract-Foundation/mpp-abstract) (MIT). Charge pattern adapted from [@stablecoin.xyz/radius-mpp](https://www.npmjs.com/package/@stablecoin.xyz/radius-mpp) (MIT). Attribution memo layout matches [Tempo's Attribution.ts](https://github.com/tempoxyz/mpp-specs) for cross-ecosystem compatibility.

## License

[MIT](LICENSE)
