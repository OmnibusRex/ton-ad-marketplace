import { Address } from "@ton/core";
import { assertTestnetEndpoint } from "./ton/network.js";
import { assertNoSigningSecrets } from "./ton/no-secrets.js";

/**
 * Existing prototype wallet used only by the live Toncenter watcher.
 * Tests never call the network; they inject a mock matcher instead.
 * Do not treat this address as a production custody contract.
 */
export const DEFAULT_ESCROW_WALLET = "UQCbTW0NWPyE28ltt2GvN5nS0XwVYyf4johavHU2fZQqhRfD";

export const DEFAULT_TONCENTER_API_URL = "https://testnet.toncenter.com/api/v2";

export const TESTNET_ESCROW_ACK = "I_UNDERSTAND_NO_BROADCAST";

export type EscrowMode = "postgres" | "ton_testnet";

export type AppConfig = {
  telegramBotToken: string;
  databaseUrl: string;
  escrowWalletAddress: string;
  toncenterApiUrl: string;
  toncenterApiKey?: string;
  orderTimeoutMs: number;
  escrowMode: EscrowMode;
  escrowContractAddress?: string;
  dbConnectAttempts: number;
  dbConnectBaseDelayMs: number;
  dbConnectMaxDelayMs: number;
  healthIntervalMs: number;
  healthFailureThreshold: number;
};

function readBoundedInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function readEscrowMode(raw: string | undefined): EscrowMode {
  const mode = raw?.trim().toLowerCase() || "postgres";
  if (mode === "postgres") {
    return "postgres";
  }
  if (mode === "ton_testnet") {
    return "ton_testnet";
  }
  throw new Error("ESCROW_MODE must be postgres (default) or ton_testnet. Mainnet is not supported.");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  assertNoSigningSecrets(env);
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!telegramBotToken || !databaseUrl) {
    throw new Error("Missing required env vars: TELEGRAM_BOT_TOKEN and DATABASE_URL");
  }
  const timeoutRaw = env.ORDER_TIMEOUT_MS?.trim();
  const orderTimeoutMs = timeoutRaw ? Number(timeoutRaw) : 60 * 60 * 1000;
  if (!Number.isFinite(orderTimeoutMs) || orderTimeoutMs <= 0) {
    throw new Error("ORDER_TIMEOUT_MS must be a positive number of milliseconds");
  }
  const toncenterApiUrl = env.TONCENTER_API_URL?.trim() || DEFAULT_TONCENTER_API_URL;
  assertTestnetEndpoint(toncenterApiUrl);

  const escrowMode = readEscrowMode(env.ESCROW_MODE);
  const escrowContractAddress = env.ESCROW_CONTRACT_ADDRESS?.trim() || undefined;
  if (escrowMode === "ton_testnet") {
    if (env.ESCROW_TESTNET_ACK?.trim() !== TESTNET_ESCROW_ACK) {
      throw new Error(
        "ESCROW_MODE=ton_testnet refuses to start unless ESCROW_TESTNET_ACK=I_UNDERSTAND_NO_BROADCAST. " +
          "That mode does not broadcast TON. Leave ESCROW_MODE unset to keep PostgresEscrow.",
      );
    }
    if (!escrowContractAddress) {
      throw new Error("ESCROW_CONTRACT_ADDRESS is required when ESCROW_MODE=ton_testnet");
    }
    try {
      Address.parse(escrowContractAddress);
    } catch {
      throw new Error("ESCROW_CONTRACT_ADDRESS is not a valid TON address");
    }
  }

  const dbConnectBaseDelayMs = readBoundedInt(env, "DB_CONNECT_BASE_DELAY_MS", 500, 50, 10_000);
  const dbConnectMaxDelayMs = readBoundedInt(env, "DB_CONNECT_MAX_DELAY_MS", 30_000, 50, 120_000);
  if (dbConnectMaxDelayMs < dbConnectBaseDelayMs) {
    throw new Error("DB_CONNECT_MAX_DELAY_MS must be greater than or equal to DB_CONNECT_BASE_DELAY_MS");
  }

  return {
    telegramBotToken,
    databaseUrl,
    escrowWalletAddress: env.ESCROW_WALLET_ADDRESS?.trim() || DEFAULT_ESCROW_WALLET,
    toncenterApiUrl,
    toncenterApiKey: env.TONCENTER_API_KEY?.trim() || undefined,
    orderTimeoutMs,
    escrowMode,
    escrowContractAddress,
    dbConnectAttempts: readBoundedInt(env, "DB_CONNECT_ATTEMPTS", 5, 1, 10),
    dbConnectBaseDelayMs,
    dbConnectMaxDelayMs,
    healthIntervalMs: readBoundedInt(env, "HEALTH_INTERVAL_MS", 60_000, 5_000, 600_000),
    healthFailureThreshold: readBoundedInt(env, "HEALTH_FAILURE_THRESHOLD", 5, 1, 30),
  };
}
