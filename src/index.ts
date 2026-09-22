import * as dotenv from "dotenv";
import { createBot } from "./bot.js";
import { loadConfig, type AppConfig } from "./config.js";
import { retryTransient } from "./db/retry.js";
import { createPostgresPool, wrapPool, type PgDatabase } from "./db/postgres.js";
import { Marketplace } from "./domain/marketplace.js";
import { createLiveEscrow } from "./escrow-factory.js";
import { startHealthSignal } from "./health.js";
import { sanitizeForLog } from "./log.js";
import { PostgresStore } from "./adapters/postgres-store.js";

dotenv.config();

function retryOptions(config: AppConfig, label: string) {
  return {
    attempts: config.dbConnectAttempts,
    baseDelayMs: config.dbConnectBaseDelayMs,
    maxDelayMs: config.dbConnectMaxDelayMs,
    label,
  };
}

async function connectAndMigrate(db: PgDatabase, config: AppConfig, store: PostgresStore): Promise<void> {
  await retryTransient(() => db.query("SELECT 1"), retryOptions(config, "database connect"));
  await retryTransient(() => store.migrate(), retryOptions(config, "database migrate"));
}

async function startProject(): Promise<void> {
  const config = loadConfig();
  const pool = createPostgresPool(config.databaseUrl);
  const db = wrapPool(pool);
  let healthStop = (): void => {};
  let sweepTimer: ReturnType<typeof setInterval> | undefined;

  const shutdown = async (): Promise<void> => {
    healthStop();
    if (sweepTimer) {
      clearInterval(sweepTimer);
    }
    await pool.end().catch(() => undefined);
  };

  try {
    const store = new PostgresStore(db);
    await connectAndMigrate(db, config, store);
    const escrow = createLiveEscrow(config, db);
    const marketplace = new Marketplace({
      store,
      escrow,
      transactions: db,
      orderTimeoutMs: config.orderTimeoutMs,
    });

    const bot = createBot({
      token: config.telegramBotToken,
      marketplace,
      users: store,
      escrowWalletAddress: config.escrowWalletAddress,
      toncenterApiUrl: config.toncenterApiUrl,
      toncenterApiKey: config.toncenterApiKey,
    });

    const sweep = async () => {
      try {
        const refunded = await marketplace.refundExpiredOrders();
        if (refunded.length > 0) {
          console.log(`Refunded ${refunded.length} timed-out order(s); owners were not paid.`);
        }
      } catch (error) {
        console.error(`Timeout sweep failed: ${sanitizeForLog(error)}`);
      }
    };
    sweepTimer = setInterval(() => {
      void sweep();
    }, 60_000);
    if (typeof sweepTimer.unref === "function") {
      sweepTimer.unref();
    }

    const health = startHealthSignal({
      intervalMs: config.healthIntervalMs,
      failureThreshold: config.healthFailureThreshold,
      escrowMode: config.escrowMode,
      check: async () => {
        await retryTransient(() => db.query("SELECT 1"), {
          ...retryOptions(config, "health"),
          attempts: 2,
        });
      },
    });
    healthStop = health.stop;

    const stop = (signal: string) => {
      console.log(`Shutting down (${signal})`);
      void shutdown().finally(() => process.exit(0));
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));

    if (config.escrowMode === "ton_testnet") {
      console.warn(
        "TrustLayer online: ESCROW_MODE=ton_testnet. Mutators fail closed and do not broadcast. " +
          "Payment detection still uses Toncenter. The live default is PostgresEscrow.",
      );
    } else {
      console.log(
        "TrustLayer online: PostgresEscrow ledger, Toncenter testnet payment detection. No on-chain payouts.",
      );
    }
    await bot.start();
  } catch (error) {
    console.error(`Critical Start Error: ${sanitizeForLog(error)}`);
    await shutdown();
    process.exit(1);
  }
}

void startProject();
