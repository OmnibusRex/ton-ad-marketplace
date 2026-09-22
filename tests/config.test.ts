import { Address } from "@ton/core";
import { describe, expect, it } from "vitest";
import { PostgresEscrow } from "../src/adapters/postgres-escrow.js";
import { TonContractEscrow } from "../src/adapters/ton-contract-escrow.js";
import { loadConfig, TESTNET_ESCROW_ACK } from "../src/config.js";
import type { SqlQueryable } from "../src/db/sql.js";
import { createLiveEscrow } from "../src/escrow-factory.js";

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "123456:TEST",
  DATABASE_URL: "postgres://user:secret@localhost:5432/ton_ads",
};

const contract = Address.parse(`0:${"11".repeat(32)}`).toString({ testOnly: true, bounceable: true });

describe("runtime config", () => {
  it("defaults to PostgresEscrow and the testnet watcher", () => {
    const config = loadConfig(baseEnv);
    expect(config.escrowMode).toBe("postgres");
    expect(config.toncenterApiUrl).toContain("testnet.toncenter.com");
    expect(config.dbConnectAttempts).toBe(5);
    expect(config.healthIntervalMs).toBe(60_000);
    const db: SqlQueryable = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };
    expect(createLiveEscrow(config, db)).toBeInstanceOf(PostgresEscrow);
  });

  it("rejects mainnet mode, mainnet URLs, mnemonics, and an unacknowledged testnet switch", () => {
    expect(() => loadConfig({ ...baseEnv, ESCROW_MODE: "mainnet" })).toThrow(/ESCROW_MODE/);
    expect(() => loadConfig({ ...baseEnv, TONCENTER_API_URL: "https://toncenter.com/api/v2" })).toThrow(/[Mm]ainnet/);
    expect(() => loadConfig({ ...baseEnv, MNEMONIC: "alpha beta gamma" })).toThrow(/signing secrets/);
    expect(() =>
      loadConfig({
        ...baseEnv,
        ESCROW_MODE: "ton_testnet",
        ESCROW_CONTRACT_ADDRESS: contract,
      }),
    ).toThrow(/ESCROW_TESTNET_ACK/);
  });

  it("selects the non-broadcasting adapter only with the explicit testnet acknowledgement", () => {
    const config = loadConfig({
      ...baseEnv,
      ESCROW_MODE: "ton_testnet",
      ESCROW_CONTRACT_ADDRESS: contract,
      ESCROW_TESTNET_ACK: TESTNET_ESCROW_ACK,
    });
    const db: SqlQueryable = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };
    expect(createLiveEscrow(config, db)).toBeInstanceOf(TonContractEscrow);
  });
});
