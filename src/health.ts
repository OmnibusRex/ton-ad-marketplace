import { sanitizeForLog } from "./log.js";

export function nextFailureCount(previous: number, ok: boolean): number {
  return ok ? 0 : previous + 1;
}

export function formatHealthLine(input: {
  ok: boolean;
  escrowMode: string;
  uptimeSeconds: number;
  consecutiveFailures: number;
  error?: string;
}): string {
  if (input.ok) {
    return `health ok db=up escrow=${input.escrowMode} uptime_s=${input.uptimeSeconds} failures=0`;
  }
  return `health fail db=down escrow=${input.escrowMode} uptime_s=${input.uptimeSeconds} consecutive_failures=${input.consecutiveFailures} error=${input.error ?? "unknown"}`;
}

export type HealthMonitorOptions = {
  failureThreshold: number;
  escrowMode: string;
  check: () => Promise<void>;
  log?: (line: string) => void;
  exit?: (code: number) => void;
  now?: () => Date;
  startedAt?: Date;
};

export function createHealthMonitor(options: HealthMonitorOptions): {
  tick: () => Promise<void>;
  stop: () => void;
} {
  let stopped = false;
  let failures = 0;
  const now = options.now ?? (() => new Date());
  const startedAt = options.startedAt ?? now();
  const log = options.log ?? ((line: string) => console.log(line));
  const exit = options.exit ?? ((code: number) => process.exit(code));

  return {
    stop() {
      stopped = true;
    },
    async tick() {
      if (stopped) {
        return;
      }
      const uptimeSeconds = Math.max(0, Math.floor((now().getTime() - startedAt.getTime()) / 1000));
      try {
        await options.check();
        if (stopped) {
          return;
        }
        failures = nextFailureCount(failures, true);
        log(
          formatHealthLine({
            ok: true,
            escrowMode: options.escrowMode,
            uptimeSeconds,
            consecutiveFailures: failures,
          }),
        );
      } catch (error) {
        if (stopped) {
          return;
        }
        failures = nextFailureCount(failures, false);
        log(
          formatHealthLine({
            ok: false,
            escrowMode: options.escrowMode,
            uptimeSeconds,
            consecutiveFailures: failures,
            error: sanitizeForLog(error),
          }),
        );
        if (failures >= options.failureThreshold) {
          log(
            `health exit db=down escrow=${options.escrowMode} consecutive_failures=${failures} ` +
              "Railway ON_FAILURE can restart the worker.",
          );
          stopped = true;
          exit(1);
        }
      }
    },
  };
}

export type HealthSignal = {
  stop: () => void;
  firstTick: Promise<void>;
};

/**
 * Stdout heartbeat for a long-polling worker. There is no HTTP port.
 * Repeated database failures exit the process so the host restart policy runs.
 */
export function startHealthSignal(
  options: HealthMonitorOptions & {
    intervalMs: number;
  },
): HealthSignal {
  let timer: ReturnType<typeof setInterval> | undefined;
  const monitor = createHealthMonitor({
    ...options,
    exit: (code) => {
      if (timer) {
        clearInterval(timer);
      }
      (options.exit ?? ((exitCode: number) => process.exit(exitCode)))(code);
    },
  });
  timer = setInterval(() => {
    void monitor.tick();
  }, options.intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return {
    stop() {
      if (timer) {
        clearInterval(timer);
      }
      monitor.stop();
    },
    firstTick: monitor.tick(),
  };
}
