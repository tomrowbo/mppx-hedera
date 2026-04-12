# mppx-hedera

Native [Machine Payments Protocol](https://mpp.dev) method for [Hedera](https://hedera.com).

[![npm](https://img.shields.io/npm/v/mppx-hedera)](https://www.npmjs.com/package/mppx-hedera)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](packages/mppx-hedera/LICENSE)

```bash
npm install mppx-hedera
```

## What is this

An [mppx](https://github.com/wevm/mppx) plugin that settles HTTP 402 payments in USDC on Hedera. Two payment intents:

- **Charge** — one-time ERC-20 transfer per request
- **Session** — payment channel escrow: one deposit, unlimited off-chain vouchers, one settlement. N requests = 2 on-chain transactions.

No facilitator. The server verifies directly against Hedera's JSON-RPC relay and Mirror Node.

## Packages

| Package | Description |
|---|---|
| [`packages/mppx-hedera`](packages/mppx-hedera) | The SDK — client + server methods for mppx ([README](packages/mppx-hedera/README.md)) |
| [`contracts`](contracts) | HederaStreamChannel.sol — ERC-20 payment channel escrow |

## Deployed contracts

| Network | HederaStreamChannel | USDC |
|---|---|---|
| Mainnet | [`0xb68B...2BF`](https://hashscan.io/mainnet/contract/0xAE27c6a54aD536a2De47B6B096Ca3FBcee738eFB) | 0.0.456858 (Circle) |
| Testnet | [`0x2474...6e8`](https://hashscan.io/testnet/contract/0xd5235aC832d606E8f1E0Aa40a675b54483F6fe43) | 0.0.5449 |

## Quick example

```ts
// Server
import { Mppx } from 'mppx/server'
import { charge } from 'mppx-hedera/server'

const mppx = Mppx.create({ methods: [charge()] })

const result = await mppx.charge({ amount: '0.01' })(request)
if (result.status === 402) return result.challenge
return result.withReceipt(Response.json({ data: '...' }))
```

See [`packages/mppx-hedera/README.md`](packages/mppx-hedera/README.md) for full documentation.

## License

MIT
