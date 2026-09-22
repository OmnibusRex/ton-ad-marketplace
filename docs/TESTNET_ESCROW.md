# Testnet escrow (manual, unsigned)

The live bot stays on `PostgresEscrow`. This page is the next step toward a TON testnet contract. Nothing here deploys, signs, or spends TON.

`contracts/escrow.fc` is unaudited. Do not deploy it to mainnet.

## What the code will and will not do

| `ESCROW_MODE` | Escrow | Broadcasts TON? |
| --- | --- | --- |
| unset or `postgres` (Railway default) | `PostgresEscrow` | No |
| `ton_testnet` plus `ESCROW_TESTNET_ACK=I_UNDERSTAND_NO_BROADCAST` and `ESCROW_CONTRACT_ADDRESS` | `TonContractEscrow` | No. Lock, release, and refund throw `ESCROW_NOT_SIGNED` |

Payment detection stays on Toncenter and `ESCROW_WALLET_ADDRESS` in both modes. `ton_testnet` does not move advertisers onto the contract. Do not turn it on for `@TrustLayerTonBot` until you intend to stop the Postgres lock path.

Seller ids are Telegram user ids. The adapter will not build a deposit until a seller TON payout address exists. Release and refund can prepare an unsigned body for inspection; the process still does not send it.

## Prepare unsigned artifacts

From a checkout, with no mnemonic in the environment:

```bash
npm run prepare:escrow -- --admin <your-testnet-admin-address>
```

Optional sample deposit body (public addresses only):

```bash
npm run prepare:escrow -- \
  --admin <admin-address> \
  --seller <seller-address> \
  --order-id order-1 \
  --deadline 1800000000 \
  --amount-ton 0.1
```

`--admin` may be omitted when `ESCROW_ADMIN_ADDRESS` is set to a public address. The script refuses `--mnemonic`, a 12- or 24-word argument, `--broadcast`, `--send`, `--deploy`, and `--mainnet`.

It writes gitignored files under `contracts/build/`:

- `escrow-code.boc`
- `escrow-data.boc` (admin address + empty deals dict)
- `escrow-state-init.boc`
- `escrow-deposit.boc` only when you asked for a sample
- `MANUAL_STEPS.txt`

## What you still do yourself

1. Use a testnet wallet you control. Keep the mnemonic out of git, `.env` committed to the repo, Railway, and this script.
2. Read the BOCs and `contracts/escrow.fc` before you send anything.
3. Deploy the state init with your own testnet tool. Check the explorer host is testnet (`testnet.tonviewer.com` or similar).
4. Send spare testnet TON to the contract for forwarding fees. This repository will not send it.
5. If you use the sample deposit, send it from the advertiser wallet with the printed amount attached. The amount is not inside the body.
6. Only then set `ESCROW_CONTRACT_ADDRESS`, `ESCROW_MODE=ton_testnet`, and `ESCROW_TESTNET_ACK=I_UNDERSTAND_NO_BROADCAST` on a host you are willing to take off Postgres escrow.
7. Channel proof (bot admin, `/register_channel`, testnet payment, publish) is still the walkthrough in `docs/GO_LIVE.md`.
