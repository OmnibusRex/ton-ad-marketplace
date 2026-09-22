import { sanitizeForLog } from "../log.js";

export const MAX_DB_ATTEMPTS = 10;

const TRANSIENT_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "40001",
  "40P01",
  "53300",
]);

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

function readError(error: unknown): ErrorLike {
  if (!error || typeof error !== "object") {
    return {};
  }
  return error as ErrorLike;
}

/**
 * Neon/Postgres blips worth retrying. Unique violations and other constraint
 * errors are permanent and must not be retried.
 */
export function isTransientDbError(error: unknown): boolean {
  const candidate = readError(error);
  if (candidate.code === "23505" || candidate.code === "23514") {
    return false;
  }
  if (typeof candidate.code === "string" && TRANSIENT_CODES.has(candidate.code)) {
    return true;
  }
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return (
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("connection terminated") ||
    message.includes("connection ended") ||
    message.includes("socket hang up") ||
    message.includes("too many connections") ||
    message.includes("server closed the connection") ||
    message.includes("cannot acquire") ||
    message.includes("connection refused")
  );
}

export function backoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const jitter = exp * 0.2 * Math.min(1, Math.max(0, random()));
  return Math.round(exp + jitter);
}

export type RetryOptions = {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  label: string;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bounded retry for startup and health probes. Do not wrap payment writes:
 * a retried insert can double-apply if the first attempt committed.
 */
export async function retryTransient<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.min(MAX_DB_ATTEMPTS, Math.max(1, options.attempts));
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((line) => console.warn(line));
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === attempts) {
        throw error;
      }
      const delay = backoffDelayMs(attempt, options.baseDelayMs, options.maxDelayMs, random);
      log(
        `${options.label} failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms: ${sanitizeForLog(error)}`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
