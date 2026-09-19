# Testnet TON escrow (UNAUDITED)

**This FunC contract is unaudited and not production-safe. It is a testnet-oriented skeleton. Do not deploy it to mainnet. Do not treat a compiled BOC as custody you can trust with real value.**

The live marketplace still uses application-level `EscrowPort` (`InMemoryEscrow` in tests, `PostgresEscrow` on `npm start`). The bot does **not** broadcast on-chain payouts. Payment detection remains Toncenter comment matching against `ESCROW_WALLET_ADDRESS`.

## Product loop this contract is meant to match

| App `EscrowPort` | On-chain op | Who may call | What happens |
| --- | --- | --- | --- |
| `lock` | `op::deposit` (`1`) | Advertiser (sends TON) | Deal stored as `locked` for `sha256(orderId)` |
| `releaseToSeller` | `op::release` (`2`) | Operator only (publish-success signal) | TON sent to seller |
| `refundToAdvertiser` | `op::refund` (`3`) | Operator (failure) or anyone after `deadline` | TON sent to advertiser |
| `get` | `get_deal` | Read-only | Advertiser, seller, amount, status, deadline |

Status values: `1` locked, `2` released, `3` refunded.

The TypeScript stub `TonContractEscrow` implements `EscrowPort` and throws `ESCROW_NOT_WIRED` until a later change actually sends these messages. Product tests must keep using in-memory / Postgres escrow.

## Message bodies (for a future JS wrapper)

All bodies start with `op:uint32` then `query_id:uint64`.

**deposit**

`order_id_hash:uint256` `seller:MsgAddress` `deadline:uint64`  
Attached TON is the locked amount. Sender is the advertiser.

**release / refund**

`order_id_hash:uint256`

Initial storage at deploy: admin address (the wallet allowed to signal publish-success / failure) + empty deals dict (`store_dict(null)`).

Keep extra testnet TON on the contract so release/refund can pay forwarding fees (send mode `1`).

## Compile (no deploy)

From the repo root, after `npm ci`:

```bash
npm run compile:escrow
```

That uses `@ton-community/func-js` (WASM FunC). It writes nothing to mainnet and does not submit a transaction.

Optional native compiler (also compile-only):

```bash
func -o /tmp/escrow.fif -SPA contracts/imports/stdlib.fc contracts/escrow.fc
```

## Deploy notes — testnet only

This repository does **not** ship a deploy script that spends TON. A human who later experiments on testnet would, outside this PR:

1. Create or reuse a **testnet** operator wallet. Never put a mnemonic in git or `.env` committed to the repo.
2. Compile the contract (`npm run compile:escrow`).
3. Build init data: admin `MsgAddress` + empty deals dict.
4. Deploy the code+data cell with a testnet tool (TON CLI, Blueprint, or Tonkeeper testnet) to **testnet**. Confirm the explorer host is testnet (for example `testnet.tonviewer.com`).
5. Send a small extra testnet TON balance for gas.
6. Only then could `TonContractEscrow` be wired. Until that happens, `npm start` stays on `PostgresEscrow`.

**Do not deploy to mainnet.** There is no mainnet checklist here on purpose.

## Files

- `escrow.fc` — contract logic
- `imports/stdlib.fc` — minimal asm wrappers used by the skeleton
