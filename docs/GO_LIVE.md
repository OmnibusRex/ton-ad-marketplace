# Operator checklist (testnet)

Use this tomorrow. English, matching the rest of the repo.

This is **not** a mainnet launch. Do not deploy the FunC contract to mainnet. Do not commit `.env`, tokens, mnemonics, or API keys. This repository does not spend TON and does not deploy the bot for you.

The live bot that already runs elsewhere keeps its own secrets. This checklist is for a hosted **code** process plus a human Telegram/testnet walkthrough.

## Automated / already in code

These do not need a human at the keyboard beyond merging/CI:

- `npm test` and GitHub Actions (`.github/workflows/test.yml`) — listing, payment match, publish/release, failed publish (no release), timeout refund.
- Application escrow: `EscrowPort` via `InMemoryEscrow` (tests) and `PostgresEscrow` (`npm start`, the default). The bot still does **not** broadcast payouts.
- Toncenter watcher matches inbound comments `AdOrder_<orderId>` against `ESCROW_WALLET_ADDRESS` (source, destination, exact comment, string tx hash; bounced and outgoing transfers ignored).
- `schema.sql` plus additive constraints are applied automatically on `npm start`. Transient Neon timeouts are retried on connect/migrate. Payment writes are not blindly retried.
- Timeout sweep every 60s (`refundExpiredOrders`) — owner is not paid on that path. One bad order does not abort the rest of the sweep.
- Stdout health line (`health ok` / `health fail`). No HTTP server. Railway restarts the container if the process exits after repeated database failures (`restartPolicyType = ON_FAILURE`). Do not set an HTTP healthcheck path.
- Host scaffolding: `Dockerfile`, `railway.toml`, `Procfile`. **Pushing this PR does not deploy.**
- FunC skeleton under `contracts/` plus `TonContractEscrow`, which refuses to sign or broadcast. Leave `ESCROW_MODE` unset. `npm run compile:escrow` compiles only. `npm run prepare:escrow` writes unsigned BOCs only.

## Human steps for tomorrow

Do these yourself. Order matters.

1. **Secrets on the host only.** In Railway / Docker / the existing VPS, set the names from the README “Host the bot” table (`TELEGRAM_BOT_TOKEN`, Neon `DATABASE_URL`, `ESCROW_WALLET_ADDRESS`, `TONCENTER_*`). Use fake values in docs only. Paste real values in the host UI, never into git. Do not set `MNEMONIC` or a private key; the process exits if those names are present.
2. **Keep the live bot on Postgres escrow.** `ESCROW_MODE` stays unset or `postgres`. Do not set `ESCROW_MODE=ton_testnet` on `@TrustLayerTonBot` as part of this checklist. Confirm the watch wallet is testnet. Toncenter URL should stay on testnet (`https://testnet.toncenter.com/api/v2`). A mainnet URL is rejected.
3. **Start or keep the hosted bot process.** `npm start` (or the host’s start command). The log should say `PostgresEscrow ledger, Toncenter testnet payment detection. No on-chain payouts.` Logs then show `health ok`. The process uses long polling; it does not need a public HTTP URL. Railway does not HTTP-probe it.
4. **Add the bot as channel admin.** In the public Telegram channel: Administrators → add the bot. It needs permission to post messages. You (the listing user) must also be a creator or administrator. Listing fails otherwise.
5. **`/register_channel`.** DM the bot. Send the public handle (`@yourchannel`). Set a small testnet price in TON (for example `0.1`).
6. **`/explore`.** Confirm the listing (member count + your price). Tap **Buy Ad**. Copy the comment exactly: `AdOrder_<orderId>`.
7. **Pay on TON testnet** with that comment and the listed amount to `ESCROW_WALLET_ADDRESS` (Tonkeeper testnet / the Pay with Wallet link). Wait 1–2 minutes, tap **I have paid**.
8. **Publish path.** Send ad text. The bot should post to the channel and mark escrow **released** (application ledger). Owner is paid only on this success path — still application-level, not an on-chain payout from the FunC skeleton.
9. **Failure / timeout (optional).** Remove the bot as admin and retry publish: funds must **not** release to the owner. Or wait `ORDER_TIMEOUT_MS` and confirm the refund path (owner is not paid).

## Out of scope (do not do)

- Mainnet deploy of `contracts/escrow.fc`
- Setting `ESCROW_MODE=ton_testnet` on the live Railway service (see `docs/TESTNET_ESCROW.md` if you later experiment)
- Wiring a mnemonic into the host so the bot can sign
- Bounty marketplace, AI matching, Stars, Mini App
- Committing `.env` or rotating production secrets into the PR
