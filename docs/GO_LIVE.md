# Operator checklist (testnet)

Use this tomorrow. English, matching the rest of the repo.

This is **not** a mainnet launch. Do not deploy the FunC contract to mainnet. Do not commit `.env`, tokens, mnemonics, or API keys. This repository does not spend TON and does not deploy the bot for you.

The live bot that already runs elsewhere keeps its own secrets. This checklist is for a hosted **code** process plus a human Telegram/testnet walkthrough.

## Automated / already in code

These do not need a human at the keyboard beyond merging/CI:

- `npm test` and GitHub Actions (`.github/workflows/test.yml`) — listing, payment match, publish/release, failed publish (no release), timeout refund.
- Application escrow: `EscrowPort` via `InMemoryEscrow` (tests) and `PostgresEscrow` (`npm start`). The bot still does **not** broadcast payouts.
- Toncenter watcher matches inbound comments `AdOrder_<orderId>` against `ESCROW_WALLET_ADDRESS`.
- `schema.sql` is applied automatically on `npm start`.
- Timeout sweep every 60s (`refundExpiredOrders`) — owner is not paid on that path.
- Host scaffolding: `Dockerfile`, `railway.toml`, `Procfile`. **Pushing this PR does not deploy.**
- FunC skeleton under `contracts/` plus `TonContractEscrow` stub. Product loop stays on in-memory/Postgres escrow. `npm run compile:escrow` compiles only; it does not deploy.

## Human steps for tomorrow

Do these yourself. Order matters.

1. **Secrets on the host only.** In Railway / Docker / the existing VPS, set the names from the README “Host the bot” table (`TELEGRAM_BOT_TOKEN`, Neon `DATABASE_URL`, `ESCROW_WALLET_ADDRESS`, `TONCENTER_*`). Use fake values in docs only. Paste real values in the host UI, never into git.
2. **Confirm the watch wallet is testnet.** `ESCROW_WALLET_ADDRESS` is the address advertisers pay. Toncenter URL should stay on testnet (`https://testnet.toncenter.com/api/v2` unless you already run something else). Do not point payment at a mainnet custody contract.
3. **Start or keep the hosted bot process.** `npm start` (or the host’s start command). You should see the TrustLayer operational log. The process uses long polling; it does not need a public HTTP URL.
4. **Add the bot as channel admin.** In the public Telegram channel: Administrators → add the bot. It needs permission to post messages. Listing fails if the bot is not admin.
5. **`/register_channel`.** DM the bot. Send the public handle (`@yourchannel`). Set a small testnet price in TON (for example `0.1`).
6. **`/explore`.** Confirm the listing (member count + your price). Tap **Buy Ad**. Copy the comment exactly: `AdOrder_<orderId>`.
7. **Pay on TON testnet** with that comment and the listed amount to `ESCROW_WALLET_ADDRESS` (Tonkeeper testnet / the Pay with Wallet link). Wait 1–2 minutes, tap **I have paid**.
8. **Publish path.** Send ad text. The bot should post to the channel and mark escrow **released** (application ledger). Owner is paid only on this success path — still application-level, not an on-chain payout from the FunC skeleton.
9. **Failure / timeout (optional).** Remove the bot as admin and retry publish: funds must **not** release to the owner. Or wait `ORDER_TIMEOUT_MS` and confirm the refund path (owner is not paid).

## Out of scope (do not do)

- Mainnet deploy of `contracts/escrow.fc`
- Wiring `TonContractEscrow` into `npm start` in this checklist
- Bounty marketplace, AI matching, Stars, Mini App
- Committing `.env` or rotating production secrets into the PR
