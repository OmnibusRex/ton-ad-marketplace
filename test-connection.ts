import axios from "axios";
import * as dotenv from "dotenv";
import { DEFAULT_ESCROW_WALLET, DEFAULT_TONCENTER_API_URL } from "./src/config.js";
import { createPostgresPool } from "./src/db/postgres.js";
import { retryTransient } from "./src/db/retry.js";
import { sanitizeForLog } from "./src/log.js";
import { assertNoSigningSecrets } from "./src/ton/no-secrets.js";
import { assertTestnetEndpoint } from "./src/ton/network.js";

dotenv.config();

async function runDiagnostic(): Promise<void> {
  console.log("TrustLayer diagnostics (no secrets printed)");
  assertNoSigningSecrets(process.env);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is missing. Set it on the host, not in git.");
    process.exitCode = 1;
    return;
  }

  const pool = createPostgresPool(databaseUrl);
  try {
    await retryTransient(() => pool.query("SELECT NOW() AS now"), {
      attempts: 5,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      label: "diagnose database",
    });
    console.log("Database connection succeeded.");
  } catch (error) {
    console.error(`Database connection failed: ${sanitizeForLog(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }

  const apiUrl = process.env.TONCENTER_API_URL?.trim() || DEFAULT_TONCENTER_API_URL;
  try {
    assertTestnetEndpoint(apiUrl);
  } catch (error) {
    console.error(sanitizeForLog(error));
    process.exitCode = 1;
    return;
  }
  const wallet = process.env.ESCROW_WALLET_ADDRESS?.trim() || DEFAULT_ESCROW_WALLET;
  const url = `${apiUrl.replace(/\/$/, "")}/getTransactions`;
  try {
    const response = await axios.get(url, { params: { address: wallet, limit: 1 }, timeout: 15_000 });
    if (response.data?.ok) {
      console.log("Toncenter testnet endpoint is reachable. This check does not spend TON.");
    } else {
      console.error("Toncenter responded without ok=true.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Toncenter request failed: ${sanitizeForLog(error)}`);
    process.exitCode = 1;
  }
}

void runDiagnostic();
