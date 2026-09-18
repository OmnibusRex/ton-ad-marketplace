# TON Ad Marketplace

Seller-priced Telegram channel ad slots, paid in TON.

A channel owner lists a **public** channel at a price they set. An advertiser buys **one post**. Payment is locked to that order (escrow) until the bot publishes the ad. The owner is paid only if publish succeeds. If publish fails or the order times out, the owner is not paid and the order follows a refund path.

This is not a bounty marketplace, not AI matching, not a dispute DAO, and not a Mini App.

## Product loop

1. **List.** The owner sends a public `@handle`. The bot checks it is an admin in that channel, records the live member count, and stores the owner-set price in TON.
2. **Buy.** An advertiser opens `/explore`, picks a channel, and creates an order. Payment is detected by comment (`AdOrder_<orderId>`) and **locked to that order**.
3. **Publish.** After the lock, the advertiser sends the ad text. The bot posts it to the target channel.
4. **Settle.** Successful publish **releases** escrow to the channel owner. Failed publish leaves funds locked (owner is not paid). Timeout or an explicit refund **returns** the lock to the advertiser.

## Escrow design

The original prototype watched Toncenter comments into a hot wallet. That is payment *detection*, not custody: nothing bound "owner is paid" to "the post actually went up."

This repo uses an **application-level escrow state machine** (`EscrowPort`: `lock` / `releaseToSeller` / `refundToAdvertiser`). Tests exercise that machine with an in-memory ledger. A future TON contract can implement the same port. This ledger is **not** an audited on-chain contract and must not be treated as production-safe settlement. Nothing here is deployed to mainnet, and the bot never broadcasts payouts.

## Tests

No Telegram token, database, or TON credentials are required.

```bash
npm test
```

That command covers listing, payment match, successful publish (release), failed publish (no release), and timeout/refund (owner is not paid).

CI runs the same command (`.github/workflows/test.yml`).

## Run the live bot

The bot process still starts when environment variables are present. You do not need a live bot to review this product: tests are the source of truth.

```bash
npm start
```

Optional connectivity ping (needs a real database URL):

```bash
npm run diagnose
```

### Environment variables

| Name | Required | Example (fake) | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | `123456:FAKESECRET_s2t3u4v5w6x7y8z9a0b1` | Grammy bot token |
| `DATABASE_URL` | yes | `postgres://user:pass@localhost:5432/ton_ads` | Postgres connection string |
| `ESCROW_WALLET_ADDRESS` | no | `UQB_FAKE_WATCH_ADDRESS_FOR_DOCS_ONLY` | Address the Toncenter watcher inspects for inbound payments |
| `TONCENTER_API_URL` | no | `https://testnet.toncenter.com/api/v2` | Toncenter REST base URL |
| `TONCENTER_API_KEY` | no | `toncenter-test-key-not-real` | Optional Toncenter API key |
| `ORDER_TIMEOUT_MS` | no | `3600000` | Locked-order timeout before refund (milliseconds) |

Do not commit a `.env` file or real secrets. If `ESCROW_WALLET_ADDRESS` is omitted, the process falls back to the watch address already present in the original prototype. That fallback is a detection address, not a custody contract.

Schema used on live start: `schema.sql` (also applied automatically on `npm start`).

### Bot commands

- `/start` — intro
- `/register_channel` — owner lists a public channel (admin check + member count + price)
- `/explore` — advertiser browses listings and buys one post

Copy is English, matching the original TrustLayer bot.

## Layout

- `src/domain/` — orders, listing, escrow port, money helpers
- `src/adapters/` — in-memory store (tests), Postgres store/escrow (live), Toncenter watcher
- `src/bot.ts` — Telegram UI
- `tests/` — state-machine coverage
