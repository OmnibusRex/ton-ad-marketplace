# TON Ad Marketplace

Seller-priced Telegram channel ad slots, paid in TON.

A channel owner lists a **public** channel at a price they set. An advertiser buys **one post**. Payment is locked to that order (escrow) until the bot publishes the ad. The owner is paid only if publish succeeds. If publish fails or the order times out, the owner is not paid and the order follows a refund path.

This is not a bounty marketplace, not AI matching, not a dispute DAO, and not a Mini App.

## Product loop

1. **List.** The owner sends a public `@handle`. The bot checks that this user is a channel admin and that the bot can post, records the live member count, and stores the owner-set price in TON.
2. **Buy.** An advertiser opens `/explore`, picks a channel, and creates an order. Payment is detected by comment (`AdOrder_<orderId>`) and **locked to that order**.
3. **Publish.** After the lock, the advertiser sends the ad text. The bot posts it to the target channel.
4. **Settle.** Successful publish **releases** escrow to the channel owner. Failed publish leaves funds locked (owner is not paid). Timeout or an explicit refund **returns** the lock to the advertiser.

## Escrow design

The original prototype watched Toncenter comments into a hot wallet. That is payment *detection*, not custody: nothing bound "owner is paid" to "the post actually went up."

This repo uses an **application-level escrow state machine** (`EscrowPort`: `lock` / `releaseToSeller` / `refundToAdvertiser`). Tests exercise that machine with an in-memory ledger. Live `npm start` uses the same port on Postgres. The bot never broadcasts payouts.

`contracts/escrow.fc` is an **unaudited testnet FunC skeleton** for the same three operations (deposit/lock, release after a publish signal, refund on timeout/failure). `TonContractEscrow` implements `EscrowPort` and **does not broadcast**. It is used only when `ESCROW_MODE=ton_testnet` is set together with an acknowledgement and a contract address; even then every mutator throws `ESCROW_NOT_SIGNED`. The default start path is still `PostgresEscrow`. The contract is **not** production-safe and **must not** be deployed to mainnet. See `contracts/README.md` and `docs/TESTNET_ESCROW.md`.

## Tests

No Telegram token, database, or TON credentials are required.

```bash
npm test
```

That command covers listing, payment match, successful publish (release), failed publish (no release), timeout/refund (owner is not paid), the non-broadcasting `TonContractEscrow` adapter, and a compile check of the FunC skeleton (no transaction is sent).

CI runs `npm test`, `npm run typecheck`, and `npm run compile:escrow` (`.github/workflows/test.yml`).

```bash
npm run compile:escrow
```

Compile-only. Does not deploy and does not spend TON.

## Host the bot

The Grammy process uses long polling (`bot.start()`). It does not need a public HTTPS URL. Host it as an always-on worker (Docker, Railway, a VPS), not as a laptop `npm start` you close overnight.

**Secrets stay in the host.** Never commit `.env`, tokens, or mnemonics. `.env.example` lists **names and fake values only**.

| Name | Required | Example (fake) | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | `123456:FAKESECRET_s2t3u4v5w6x7y8z9a0b1` | Grammy bot token from [@BotFather](https://t.me/BotFather) |
| `DATABASE_URL` | yes | `postgres://user:pass@ep-fake-neon-id.region.aws.neon.tech/neondb?sslmode=require` | Neon (or any Postgres) connection string |
| `ESCROW_WALLET_ADDRESS` | no | `UQB_FAKE_WATCH_ADDRESS_FOR_DOCS_ONLY` | Address the Toncenter watcher inspects for inbound payments |
| `TONCENTER_API_URL` | no | `https://testnet.toncenter.com/api/v2` | Toncenter REST base URL (keep testnet) |
| `TONCENTER_API_KEY` | no | `toncenter-test-key-not-real` | Optional Toncenter API key |
| `ORDER_TIMEOUT_MS` | no | `3600000` | Locked-order timeout before refund (milliseconds) |
| `ESCROW_MODE` | no | `postgres` | `postgres` (default) or `ton_testnet`. Mainnet is rejected |
| `ESCROW_TESTNET_ACK` | only with `ton_testnet` | `I_UNDERSTAND_NO_BROADCAST` | Required acknowledgement. That mode still does not send TON |
| `ESCROW_CONTRACT_ADDRESS` | only with `ton_testnet` | *(address you deployed)* | Testnet contract address. Leave empty on Railway |
| `DB_CONNECT_ATTEMPTS` | no | `5` | Bounded Neon connect/migrate retries (max 10) |
| `HEALTH_INTERVAL_MS` | no | `60000` | Stdout health line interval. Minimum 5000 |
| `HEALTH_FAILURE_THRESHOLD` | no | `5` | Consecutive failed probes before the process exits |

Scaffolding in this repo (does **not** deploy by itself):

- `Dockerfile` — `npm ci` then `npm start` (same live start path: `tsx src/index.ts`). Do not copy `.env` into the image.
- `railway.toml` — Docker builder + `npm start`. Set the table above in the Railway variables UI.
- `Procfile` — `web: npm start` for Heroku-style hosts.

Example Docker run (values are fake; replace them on the host):

```bash
docker build -t ton-ad-marketplace .
docker run --rm \
  -e TELEGRAM_BOT_TOKEN=123456:FAKESECRET_s2t3u4v5w6x7y8z9a0b1 \
  -e DATABASE_URL=postgres://user:pass@ep-fake-neon-id.region.aws.neon.tech/neondb?sslmode=require \
  -e ESCROW_WALLET_ADDRESS=UQB_FAKE_WATCH_ADDRESS_FOR_DOCS_ONLY \
  -e TONCENTER_API_URL=https://testnet.toncenter.com/api/v2 \
  -e TONCENTER_API_KEY=toncenter-test-key-not-real \
  ton-ad-marketplace
```

Operator walkthrough (human vs automated steps): [`docs/GO_LIVE.md`](docs/GO_LIVE.md).

Unsigned testnet contract steps: [`docs/TESTNET_ESCROW.md`](docs/TESTNET_ESCROW.md). Residual risks: [`SECURITY.md`](SECURITY.md).

## How Railway knows the worker is healthy

`npm start` is a Grammy long-polling process. It does not open an HTTP port, and `railway.toml` does not set `healthcheckPath`. Railway treats the deployment as up while that process keeps running.

The process prints a stdout line about once a minute:

```text
health ok db=up escrow=postgres uptime_s=60 failures=0
```

Startup connects through a small pool (`max` 3) and retries transient Neon errors (`ETIMEDOUT` and friends) with exponential backoff, up to `DB_CONNECT_ATTEMPTS`. Idle client errors are logged and do not crash Node by themselves. If the database probe keeps failing for `HEALTH_FAILURE_THRESHOLD` intervals, the process exits 1. `restartPolicyType = ON_FAILURE` can start it again. Do not point a Railway HTTP healthcheck at this service; nothing is listening, and the deploy would flap.

Leave `ESCROW_MODE` unset on the live service. The boot log should say `PostgresEscrow ledger` and must not say that on-chain payouts are enabled.

## Run the live bot locally

The bot process still starts when environment variables are present. You do not need a live bot to review this product: tests are the source of truth.

```bash
npm start
```

Optional connectivity ping (needs a real database URL):

```bash
npm run diagnose
```

Copy `.env.example` to a local `.env` (gitignored) and fill values on your machine. Names and fake examples are in **Host the bot** above. If `ESCROW_WALLET_ADDRESS` is omitted, the process falls back to the watch address already present in the original prototype. That fallback is a detection address, not a custody contract.

Schema used on live start: `schema.sql` (also applied automatically on `npm start`).

### Bot commands

- `/start` — intro
- `/register_channel` — owner lists a public channel (admin check + member count + price)
- `/explore` — advertiser browses listings and buys one post

Copy is English, matching the original TrustLayer bot.

## Layout

- `src/domain/` — orders, listing, escrow port, money helpers
- `src/adapters/` — in-memory store (tests), Postgres store/escrow (live), Toncenter watcher, `TonContractEscrow` stub
- `src/bot.ts` — Telegram UI
- `contracts/` — unaudited FunC testnet escrow skeleton
- `Dockerfile`, `railway.toml`, `Procfile` — host the Grammy bot
- `docs/GO_LIVE.md` — operator checklist
- `tests/` — state-machine coverage plus contract stub / FunC compile
