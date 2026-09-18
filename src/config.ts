/**
 * Existing prototype wallet used only by the live Toncenter watcher.
 * Tests never call the network; they inject a mock matcher instead.
 * Do not treat this address as a production custody contract.
 */
export const DEFAULT_ESCROW_WALLET = "UQCbTW0NWPyE28ltt2GvN5nS0XwVYyf4johavHU2fZQqhRfD";

export const DEFAULT_TONCENTER_API_URL = "https://testnet.toncenter.com/api/v2";

export type AppConfig = {
  telegramBotToken: string;
  databaseUrl: string;
  escrowWalletAddress: string;
  toncenterApiUrl: string;
  toncenterApiKey?: string;
  orderTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
  return {
    telegramBotToken,
    databaseUrl,
    escrowWalletAddress: env.ESCROW_WALLET_ADDRESS?.trim() || DEFAULT_ESCROW_WALLET,
    toncenterApiUrl: env.TONCENTER_API_URL?.trim() || DEFAULT_TONCENTER_API_URL,
    toncenterApiKey: env.TONCENTER_API_KEY?.trim() || undefined,
    orderTimeoutMs,
  };
}
