import pg from "pg";
import * as dotenv from "dotenv";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { Marketplace } from "./domain/marketplace.js";
import { PostgresEscrow } from "./adapters/postgres-escrow.js";
import { PostgresStore } from "./adapters/postgres-store.js";

dotenv.config();

const { Client } = pg;

async function startProject() {
  const config = loadConfig();
  const client = new Client({ connectionString: config.databaseUrl });

  try {
    await client.connect();
    const store = new PostgresStore(client);
    await store.migrate();
    // Live start stays on application-level Postgres escrow. TonContractEscrow
    // is an unwired testnet adapter stub and must not be used here yet.
    const escrow = new PostgresEscrow(client);
    const marketplace = new Marketplace({
      store,
      escrow,
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
        console.error("Timeout sweep failed:", error);
      }
    };
    const sweepTimer = setInterval(sweep, 60_000);
    if (typeof sweepTimer.unref === "function") {
      sweepTimer.unref();
    }

    console.log("✅ TrustLayer Backend: Operational (application-level escrow, TON testnet watcher)");
    console.log("🤖 TrustLayer v1.2 Global & On-chain is Online!");
    await bot.start();
  } catch (err) {
    console.error("Critical Start Error:", err);
    process.exitCode = 1;
  }
}

void startProject();
