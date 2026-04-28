# mppx-hedera

Native [Machine Payments Protocol](https://mpp.dev) method for [Hedera](https://hedera.com).

[![npm](https://img.shields.io/npm/v/mppx-hedera)](https://www.npmjs.com/package/mppx-hedera)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](packages/mppx-hedera/LICENSE)

```bash
npm install mppx-hedera mppx viem @hiero-ledger/sdk
```

## What is this

An [mppx](https://github.com/wevm/mppx) plugin that settles HTTP 402 payments in USDC on Hedera. Two payment intents:

- **Charge** — one-time payment via native Hedera transaction with [Attribution memo](https://github.com/tempoxyz/mpp-specs) (challenge-bound, replay-proof)
- **Session** — payment channel escrow: one deposit, unlimited off-chain EIP-712 vouchers, one settlement. N requests = 2 on-chain transactions.

No facilitator. The server verifies directly against Hedera's Mirror Node REST API.

## Packages

| Package | Description |
|---|---|
| [`packages/mppx-hedera`](packages/mppx-hedera) | The SDK — client + server methods for mppx ([README](packages/mppx-hedera/README.md)) |
| [`contracts`](contracts) | HederaStreamChannel.sol — ERC-20 payment channel escrow |

## Deployed contracts

| Network | HederaStreamChannel | USDC |
|---|---|---|
| Mainnet | [`0x8Aaf...daE`](https://hashscan.io/mainnet/contract/0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE) | 0.0.456858 (Circle) |
| Testnet | [`0x8Aaf...daE`](https://hashscan.io/testnet/contract/0x8Aaf6690C2a6397d595F97E224fC19759De6fdaE) | 0.0.5449 |

Both fully verified on [Hashscan](https://hashscan.io) via Sourcify.

## Quick example

```ts
// Server — charge intent
import { Mppx } from 'mppx/server'
import { hedera } from 'mppx-hedera/server'

const mppx = Mppx.create({
  methods: [hedera.charge({ serverId: 'api.example.com', recipient: '0.0.12345', testnet: true })],
  realm: 'api.example.com',
  secretKey: process.env.MPP_SECRET_KEY,
})

const result = await mppx.charge({ amount: '0.01', currency: '0.0.5449', decimals: 6 })(request)
if (result.status === 402) return result.challenge
return result.withReceipt(Response.json({ data: '...' }))
```

```ts
// Client — charge intent
import { charge } from 'mppx-hedera/client'

const hederaCharge = charge({
  operatorId: '0.0.12345',
  operatorKey: process.env.HEDERA_PRIVATE_KEY,
  network: 'testnet',
})
```

See [`packages/mppx-hedera/README.md`](packages/mppx-hedera/README.md) for full documentation including session intents, SSE streaming, splits, and pull mode.

## License

MIT
