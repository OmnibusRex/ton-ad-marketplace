import { describe, expect, it } from "vitest";
import { createHealthMonitor, formatHealthLine, nextFailureCount, startHealthSignal } from "../src/health.js";

describe("worker health signal", () => {
  it("formats a stdout line and resets the failure count after success", () => {
    expect(nextFailureCount(3, true)).toBe(0);
    expect(nextFailureCount(3, false)).toBe(4);
    expect(
      formatHealthLine({
        ok: true,
        escrowMode: "postgres",
        uptimeSeconds: 60,
        consecutiveFailures: 0,
      }),
    ).toBe("health ok db=up escrow=postgres uptime_s=60 failures=0");
  });

  it("exits only after the configured number of consecutive database failures", async () => {
    const lines: string[] = [];
    const exits: number[] = [];
    let checks = 0;
    const monitor = createHealthMonitor({
      failureThreshold: 2,
      escrowMode: "postgres",
      now: () => new Date("2026-09-22T00:01:00.000Z"),
      startedAt: new Date("2026-09-22T00:00:00.000Z"),
      log: (line) => lines.push(line),
      exit: (code) => exits.push(code),
      check: async () => {
        checks += 1;
        if (checks === 1) {
          return;
        }
        throw new Error("connect ETIMEDOUT postgres://user:secret@host/db");
      },
    });

    await monitor.tick();
    expect(exits).toEqual([]);
    expect(lines[0]).toContain("health ok");
    await monitor.tick();
    expect(exits).toEqual([]);
    await monitor.tick();
    expect(exits).toEqual([1]);
    expect(lines.join("\n")).not.toContain("secret");
    expect(lines.join("\n")).toContain("health exit");
  });

  it("emits one immediate tick and can be stopped without leaving the interval", async () => {
    const lines: string[] = [];
    const signal = startHealthSignal({
      intervalMs: 60_000,
      failureThreshold: 5,
      escrowMode: "postgres",
      log: (line) => lines.push(line),
      exit: () => {
        throw new Error("should not exit");
      },
      check: async () => undefined,
    });
    await signal.firstTick;
    signal.stop();
    expect(lines[0]).toContain("health ok db=up escrow=postgres");
  });
});
