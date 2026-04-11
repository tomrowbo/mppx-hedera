# mppx-hedera

Native [Machine Payments Protocol](https://mpp.dev) method for [Hedera](https://hedera.com). Charge and session intents over USDC, settled directly on-chain — no facilitator required.

[![npm](https://img.shields.io/npm/v/mppx-hedera)](https://www.npmjs.com/package/mppx-hedera)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

```bash
npm install mppx-hedera mppx viem
```

## Quickstart

### Server

```ts
import { Mppx } from 'mppx/server'
import { charge } from 'mppx-hedera/server'

const mppx = Mppx.create({
  methods: [charge()],
})

export async function handler(request: Request) {
  const result = await mppx.charge({ amount: '0.01', description: 'Data query' })(request)
  if (result.status === 402) return result.challenge
  return result.withReceipt(Response.json({ data: '...' }))
}
```

### Client

```ts
import { Mppx } from 'mppx/client'
import { charge } from 'mppx-hedera/client'

const mppx = Mppx.create({
  methods: [charge({ walletClient })],
})

const res = await mppx.fetch('/api/data', { method: 'POST' })
```

The client automatically handles the `402 → sign USDC transfer → retry` flow.

## Payment intents

### Charge

One-time payment per request. The client signs a standard ERC-20 USDC `transfer()` on Hedera and the server verifies the transaction receipt.

```
Client → POST /resource
Server → 402 + WWW-Authenticate: Payment method="hedera"
Client → signs USDC transfer via Hashio JSON-RPC
Client → retries with Authorization: Payment <credential>
Server → verifies receipt + Transfer event logs
Server → 200 + Payment-Receipt header
```

### Session

Streaming micropayments via payment channels. One on-chain deposit, unlimited off-chain vouchers, one on-chain settlement.

```
Client → approve USDC + escrow.open() → 1 on-chain tx
Client → signs EIP-712 voucher per request → off-chain, <1ms
Server → ecrecover verification → no RPC, no gas
...repeat N times...
Server → escrow.settle() → 1 on-chain tx
```

**N requests = 2 on-chain transactions**, regardless of N.

## Multi-method composition

Register alongside any other mppx payment method in the same endpoint:

```ts
import { Mppx, stripe } from 'mppx/server'
import { charge as hedera } from 'mppx-hedera/server'

const mppx = Mppx.create({
  methods: [
    hedera(),
    stripe.charge({ client: stripeClient }),
  ],
})
```

The `402` challenge advertises all methods; the client uses whichever it supports.

## Deployed contracts

| Network | HederaStreamChannel | USDC | Chain ID |
|---|---|---|---|
| Testnet | [`0x8226...D83`](https://hashscan.io/testnet/contract/0x8226214188f22B9ddA901fb9ac85781eA4500D83) | `0x...001549` (0.0.5449) | 296 |
| Mainnet | [`0x3cf6...3A3`](https://hashscan.io/mainnet/contract/0x3cf652150A3f3CC768854dAb0c252E35eBd093A3) | `0x...06f89a` (0.0.456858, Circle) | 295 |

Both contracts are verified on [Hashscan](https://hashscan.io). The escrow is a port of [Tempo's StreamChannel](https://github.com/tempoxyz/mpp-specs) via [@abstract-foundation/mpp](https://github.com/Abstract-Foundation/mpp-abstract), with the EIP-712 domain set to `"Hedera Stream Channel"`.

## Hedera-specific considerations

### Token approval

HTS tokens do not support ERC-20 `approve()` through the Hedera JSON-RPC relay. Set allowances via the native Hedera SDK instead:

```ts
import { AccountAllowanceApproveTransaction } from '@hashgraph/sdk'

await new AccountAllowanceApproveTransaction()
  .approveTokenAllowance(tokenId, ownerId, spenderId, amount)
  .execute(client)
```

The native allowance is fully respected by EVM `transferFrom` calls.

### Voucher signing

Session vouchers use EIP-712 typed data. Sign with `signTypedData` (raw ECDSA), not `personal_sign`. The escrow contract verifies via `ecrecover` on the raw EIP-712 digest.

### Gas limits

Hashio underestimates gas for transactions involving the HTS precompile. Set explicit limits:

| Operation | Recommended gas |
|---|---|
| ERC-20 `transfer` | `500_000n` |
| `escrow.open` / `settle` / `close` | `1_500_000n` |
| `associateSelf` | `2_000_000n` |

## Architecture

```
packages/mppx-hedera/
├── src/
│   ├── client/
│   │   ├── charge.ts      ERC-20 transfer + Credential.serialize
│   │   └── session.ts     Channel lifecycle + EIP-712 vouchers
│   ├── server/
│   │   ├── charge.ts      Receipt verification + Transfer event parsing
│   │   └── session.ts     Voucher verification + on-chain settlement
│   ├── constants.ts        Chain configs, contract addresses, ABIs
│   └── internal.ts         Chain definitions, utilities
│
contracts/
├── src/
│   └── HederaStreamChannel.sol    ERC-20 payment channel escrow
└── test/
    └── HederaStreamChannel.t.sol  19 Foundry tests
```

## Roadmap

| Version | Features |
|---|---|
| **0.1.x** | Charge + session intents, testnet + mainnet |
| 0.2.0 | HCS audit trails for payment receipts |
| 0.3.0 | Native `@hashgraph/sdk` client path, gasless via fee delegation |
| 0.4.0 | PR to `wevm/mppx` core |

## Credits

Session infrastructure forked from [@abstract-foundation/mpp](https://github.com/Abstract-Foundation/mpp-abstract) (MIT). Charge pattern adapted from [@stablecoin.xyz/radius-mpp](https://www.npmjs.com/package/@stablecoin.xyz/radius-mpp) (MIT).

## License

[MIT](LICENSE)
