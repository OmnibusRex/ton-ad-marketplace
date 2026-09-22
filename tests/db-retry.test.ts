import { describe, expect, it } from "vitest";
import { backoffDelayMs, isTransientDbError, retryTransient } from "../src/db/retry.js";
import { sanitizeForLog } from "../src/log.js";
import { mapUniqueViolation } from "../src/db/unique-violation.js";

describe("database retry", () => {
  it("backs off exponentially with bounded jitter and stops at the max delay", () => {
    expect(backoffDelayMs(1, 100, 1_000, () => 0)).toBe(100);
    expect(backoffDelayMs(2, 100, 1_000, () => 0)).toBe(200);
    expect(backoffDelayMs(3, 100, 1_000, () => 0)).toBe(400);
    expect(backoffDelayMs(8, 100, 1_000, () => 0)).toBe(1_000);
    expect(backoffDelayMs(1, 100, 1_000, () => 1)).toBe(120);
  });

  it("retries transient timeouts and does not retry unique violations", async () => {
    const sleeps: number[] = [];
    const logs: string[] = [];
    let attempts = 0;
    await expect(
      retryTransient(
        async () => {
          attempts += 1;
          throw Object.assign(new Error("connect ETIMEDOUT postgres://user:secret@ep-neon.aws/db"), {
            code: "ETIMEDOUT",
          });
        },
        {
          attempts: 3,
          baseDelayMs: 100,
          maxDelayMs: 1_000,
          label: "database connect",
          random: () => 0,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          log: (line) => logs.push(line),
        },
      ),
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
    expect(logs.join("\n")).toContain("database connect failed");
    expect(logs.join("\n")).not.toContain("secret");
    expect(logs.join("\n")).toContain("postgres://[redacted]");

    let uniqueAttempts = 0;
    const unique = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "orders_payment_tx_hash_key" });
    await expect(
      retryTransient(
        async () => {
          uniqueAttempts += 1;
          throw unique;
        },
        {
          attempts: 4,
          baseDelayMs: 10,
          maxDelayMs: 10,
          label: "write",
          sleep: async () => {
            throw new Error("should not sleep");
          },
          log: () => {
            throw new Error("should not log a retry");
          },
        },
      ),
    ).rejects.toBe(unique);
    expect(uniqueAttempts).toBe(1);
    expect(isTransientDbError(unique)).toBe(false);
    expect(mapUniqueViolation(unique)?.code).toBe("PAYMENT_REUSED");
  });

  it("redacts connection strings and does not serialize arbitrary objects", () => {
    expect(sanitizeForLog(new Error("failed postgres://u:p@host/db"))).toBe("failed postgres://[redacted]");
    expect(sanitizeForLog({ password: "secret" })).toBe("unknown error");
  });
});
