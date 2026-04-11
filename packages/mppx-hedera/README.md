# mppx-hedera

**First native [Machine Payments Protocol](https://mpp.dev) method for [Hedera](https://hedera.com).** Charge + session intents, no facilitator, MIT licensed.

MPP is the IETF-track HTTP 402 standard co-developed by Stripe and Tempo, with Visa, Mastercard, OpenAI, Anthropic, Shopify, and 100+ services in the launch directory. `mppx-hedera` adds Hedera as a first-class native payment method.

## Install

```bash
npm install mppx-hedera mppx viem
```

## Quickstart

### Server (5 lines)

```ts
import { Mppx } from 'mppx/server'
import { charge } from 'mppx-hedera/server'

const mppx = Mppx.create({
  methods: [charge()],
})

// Any route — returns 402 if unpaid, 200 if paid
const result = await mppx.charge({ amount: '0.01', description: 'Data query' })(request)
if (result.status === 402) return result.challenge
return result.withReceipt(Response.json({ data: '...' }))
```

### Client (5 lines)

```ts
import { Mppx } from 'mppx/client'
import { charge } from 'mppx-hedera/client'

const mppx = Mppx.create({
  methods: [charge({ walletClient })],
})

// Handles 402 → sign USDC transfer → retry automatically
const res = await mppx.fetch('/api/data', { method: 'POST' })
```

## How it works

**Charge (one-time payment):**
1. Client requests resource → server returns `402 Payment Required` with `WWW-Authenticate: Payment method="hedera"`
2. Client signs an ERC-20 USDC transfer on Hedera via Hashio JSON-RPC
3. Client retries with `Authorization: Payment <credential>` containing the txHash
4. Server verifies via `getTransactionReceipt` + parses Transfer event from logs
5. Server returns `200 OK` with `Payment-Receipt` header

**Session (streaming micropayments):**
1. Client approves USDC for the escrow contract (via `@hashgraph/sdk`)
2. Client calls `escrow.open()` — deposits USDC, one on-chain tx
3. Each subsequent request: client signs an EIP-712 voucher (cumulative amount) — **off-chain, sub-millisecond**
4. Server verifies voucher via `ecrecover` — no RPC call, no gas
5. On close: server calls `escrow.settle()` — one on-chain tx

**Result: N API calls = 2 on-chain transactions.** Tested with 3 calls on Hedera testnet — 1 open tx, 2 off-chain vouchers.

## No facilitator

x402 on Hedera routes every payment through [Blocky402](https://hedera.com/blog/hedera-and-the-x402-payment-standard/) — a third-party facilitator service. `mppx-hedera` verifies payments directly via Hedera's own infrastructure (Hashio JSON-RPC + Mirror Node). No middleman, no trust dependency.

| | x402 via Blocky402 | mppx-hedera |
|---|---|---|
| Parties in payment flow | 4 (client → server → facilitator/verify → facilitator/settle) | 2 (client → server) |
| Third-party dependency | Yes | No |
| Session support | No | Yes |
| Integration | HTTP client to facilitator | `npm install mppx-hedera` |

## Composing with other methods

`mppx-hedera` is a drop-in alongside any other mppx payment method:

```ts
import { Mppx, stripe } from 'mppx/server'
import { charge as hedera } from 'mppx-hedera/server'

const mppx = Mppx.create({
  methods: [
    hedera(),                              // USDC on Hedera
    stripe.charge({ client: stripeClient }),  // Card via Stripe
  ],
})
```

The 402 challenge lists all methods; the client picks whichever it can pay with.

## Hedera services used

- **HTS** (Hedera Token Service) — USDC token for all payments
- **EVM / Smart Contracts** — `HederaStreamChannel.sol` escrow via Foundry
- **Mirror Node REST** — contract resolution + token balance queries
- **JSON-RPC Relay (Hashio)** — standard EVM tooling (viem, Foundry, cast)
- **HTS Precompile (0x167)** — contract self-association with USDC via `associateSelf()`

## Hedera-specific notes

Three things work differently on Hedera vs standard EVM:

1. **Token approval:** ERC-20 `approve()` via the EVM relay reverts for HTS tokens. Use `@hashgraph/sdk` `AccountAllowanceApproveTransaction` instead — the native allowance is respected by EVM `transferFrom`.

2. **Voucher signing:** Use raw ECDSA / `signTypedData` (EIP-712). Do NOT use `personal_sign` (`\x19Ethereum Signed Message` prefix) — the escrow contract expects the raw digest.

3. **Gas estimation:** Hashio underestimates gas for contracts with HTS precompile calls. Always set explicit gas: `500_000n` for transfers, `1_500_000n` for escrow operations.

## Deployed contracts

| Network | Escrow contract | USDC token |
|---|---|---|
| Testnet | [`0x8226214188f22B9ddA901fb9ac85781eA4500D83`](https://hashscan.io/testnet/contract/0x8226214188f22B9ddA901fb9ac85781eA4500D83) | `0x0000000000000000000000000000000000001549` (0.0.5449) |
| Mainnet | Not yet deployed | `0x000000000000000000000000000000000006f89a` (0.0.456858) |

## Go-to-Market

1. Publish `mppx-hedera` to npm (MIT)
2. Post in Hedera Discord #developers
3. PR to `wevm/mppx` adding `hedera` as a named export
4. Submit listing to mpp.dev payment methods directory
5. Blog post: "Why Hedera Needed Native MPP"
6. Apply for Hedera Foundation grant for mainnet deployment

## Roadmap

| Version | Features |
|---|---|
| **v0.1.0** | Charge + session intents, testnet (this release) |
| v0.2.0 | Mainnet deployment, HCS audit trails |
| v0.3.0 | Native `@hashgraph/sdk` client path, gasless via fee delegation |
| v0.4.0 | PR to `wevm/mppx` core → listed on mpp.dev |

## Credits

Forked from two production MIT-licensed packages:

- **[@abstract-foundation/mpp](https://github.com/Abstract-Foundation/mpp-abstract)** — session intent, `StreamChannel` escrow contract (port of Tempo's)
- **[@stablecoin.xyz/radius-mpp](https://www.npmjs.com/package/@stablecoin.xyz/radius-mpp)** — charge intent (plain ERC-20 transfer pattern)

Built at the [Agentic Society Hackathon @ LSE](https://hedera.com), April 2026.

## License

MIT
