import type { SqlQueryable } from "../db/sql.js";

type MigrationStep = {
  name: string;
  kind: "constraint" | "index";
  probe: string;
  apply: string;
};

const ORDER_STATUSES = [
  "awaiting_payment",
  "escrow_locked",
  "publish_failed",
  "released",
  "refunded",
  "expired",
] as const;

export const MIGRATION_STEPS: readonly MigrationStep[] = [
  {
    name: "orders_status_check",
    kind: "constraint",
    probe: `SELECT count(*)::int AS n FROM orders WHERE status NOT IN (${ORDER_STATUSES.map((status) => `'${status}'`).join(", ")})`,
    apply: `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (${ORDER_STATUSES.map((status) => `'${status}'`).join(", ")}))`,
  },
  {
    name: "escrow_receipts_status_check",
    kind: "constraint",
    probe: `SELECT count(*)::int AS n FROM escrow_receipts WHERE status NOT IN ('locked', 'released', 'refunded')`,
    apply: `ALTER TABLE escrow_receipts ADD CONSTRAINT escrow_receipts_status_check CHECK (status IN ('locked', 'released', 'refunded'))`,
  },
  {
    name: "escrow_receipts_payment_ref_unique",
    kind: "index",
    probe: `SELECT count(*)::int AS n FROM (SELECT payment_ref FROM escrow_receipts GROUP BY payment_ref HAVING count(*) > 1) d`,
    apply: `CREATE UNIQUE INDEX IF NOT EXISTS escrow_receipts_payment_ref_unique ON escrow_receipts (payment_ref)`,
  },
  {
    name: "channels_handle_lower_unique",
    kind: "index",
    probe: `SELECT count(*)::int AS n FROM (SELECT lower(handle) FROM channels GROUP BY lower(handle) HAVING count(*) > 1) d`,
    apply: `CREATE UNIQUE INDEX IF NOT EXISTS channels_handle_lower_unique ON channels (lower(handle))`,
  },
  {
    name: "channels_member_count_check",
    kind: "constraint",
    probe: `SELECT count(*)::int AS n FROM channels WHERE member_count < 0`,
    apply: `ALTER TABLE channels ADD CONSTRAINT channels_member_count_check CHECK (member_count >= 0)`,
  },
];

function probeCount(row: Record<string, unknown> | undefined): number {
  return Number(row?.n ?? 0);
}

async function alreadyApplied(db: SqlQueryable, step: MigrationStep): Promise<boolean> {
  if (step.kind === "index") {
    const found = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [step.name]);
    return Boolean(found.rows[0]);
  }
  const found = await db.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [step.name]);
  return Boolean(found.rows[0]);
}

function isDuplicateObject(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "42710");
}

/**
 * Add constraints that CREATE TABLE IF NOT EXISTS cannot add on an existing
 * database. Skip a step when current rows would violate it, and say so.
 */
export async function applyAdditiveConstraints(
  db: SqlQueryable,
  log: (line: string) => void = console.warn,
): Promise<string[]> {
  const applied: string[] = [];
  for (const step of MIGRATION_STEPS) {
    if (await alreadyApplied(db, step)) {
      continue;
    }
    const probe = await db.query(step.probe);
    const violations = probeCount(probe.rows[0]);
    if (violations > 0) {
      log(
        `Skipped ${step.name}: ${violations} existing row(s) would violate it. Fix the data, then restart to apply the constraint.`,
      );
      continue;
    }
    try {
      await db.query(step.apply);
      applied.push(step.name);
    } catch (error) {
      if (isDuplicateObject(error)) {
        continue;
      }
      throw error;
    }
  }
  return applied;
}
