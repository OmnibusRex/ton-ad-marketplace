# Security notes

This is an application-level escrow for seller-priced Telegram channel ads. It is not production custody and it is not a mainnet launch.

## What this change locks down

- Listing a channel requires the Telegram user to be that channel's creator or administrator. The check runs again when the price is saved. The bot must also be an admin or the listing is rejected.
- Only the advertiser who created an order can confirm payment, submit ad text, or publish. A stranger cannot trigger the timeout refund by calling publish.
- Toncenter matches require an inbound message: non-empty source, destination equal to the watch wallet (bounceable and non-bounceable forms), exact comment `AdOrder_<orderId>`, and a string transaction hash. Bounced messages and outgoing transfers are ignored.
- The same transaction hash cannot lock two orders. Confirming the same hash again for the same order is idempotent. Lock, order update, release, and refund run in one Postgres transaction, and status changes are conditional (`WHERE status = ...`).
- Overpayment is accepted, but the ledger locks the **order price**, not the extra amount.
- Ad text is capped at 3500 characters. Channel titles are escaped before Markdown replies.
- Signing-secret environment names (`MNEMONIC`, `TON_PRIVATE_KEY`, and the others listed in `src/ton/no-secrets.ts`) refuse startup. Values are not printed. Logs redact URLs that contain a password.
- `ESCROW_MODE` defaults to `postgres`. `ton_testnet` starts only with `ESCROW_TESTNET_ACK=I_UNDERSTAND_NO_BROADCAST` and a contract address, and its adapter throws instead of sending a transaction.
- `npm run prepare:escrow` writes unsigned BOCs. It rejects mnemonics, `--broadcast`, `--send`, `--deploy`, and `--mainnet`.
- Startup adds status checks, a unique `payment_ref`, a unique case-insensitive channel handle, and `member_count >= 0` when existing rows allow it.

## Residual risks

- Postgres escrow is a ledger, not a vault. `ESCROW_WALLET_ADDRESS` is a detection address. Whoever holds that wallet's key can move the TON. The key must stay off this repo and off Railway.
- Toncenter is a trusted reader. It can lag, omit a transaction, or return data the contract would not agree with. There is no reorg handling.
- Sellers are Telegram user ids, not TON addresses. On-chain deposit cannot pay the seller until a payout address exists. The testnet adapter therefore does not build a deposit body.
- The FunC contract is unaudited. One admin key can release. Refund-after-deadline is permissionless on chain. Forwarding fees use send mode 1, so the contract needs spare testnet TON. Do not deploy it to mainnet.
- A publish that succeeds in Telegram and then fails before the database commit can post twice if the advertiser retries. The ledger itself rolls back together.
- Grammy sessions are in memory. A restart forgets an in-progress listing or ad-text step. Orders remain in Postgres.
- The timeout sweep refunds on the application ledger. It does not send TON back. A human still has to return testnet funds from the watch wallet.
- If old rows violate a new constraint, startup skips that constraint and logs a warning. Duplicate handles or payment refs can remain until the data is cleaned.
- Any channel administrator, not only the creator, can list the channel and be recorded as the seller.
- There is no self-purchase block. A channel admin can buy their own slot.
- The default watch address in code is the original prototype address. Set `ESCROW_WALLET_ADDRESS` on the host if that wallet is not yours.
- `ton_testnet` mode does not switch payments to the contract. Advertisers would still pay the watch wallet, and lock would then fail closed. Do not enable it on the live Railway service.

## What Everton still does by hand

- Put `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, and the watch-wallet settings in the Railway UI. Do not commit them.
- Leave `ESCROW_MODE` unset or `postgres` on the bot that is already live.
- Add the bot as a channel admin, run `/register_channel`, pay from a testnet wallet, and publish. See `docs/GO_LIVE.md`.
- Fund and sign any future testnet contract deploy outside this repository. See `docs/TESTNET_ESCROW.md`.
