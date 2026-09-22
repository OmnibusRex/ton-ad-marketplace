import { describe, expect, it, vi } from "vitest";
import { PostgresEscrow } from "../src/adapters/postgres-escrow.js";
import { applyAdditiveConstraints, MIGRATION_STEPS } from "../src/adapters/postgres-migrate.js";
import { PostgresStore } from "../src/adapters/postgres-store.js";
import { PgDatabase, createPostgresPool } from "../src/db/postgres.js";
import type { SqlQueryable, SqlResult } from "../src/db/sql.js";
import type { Order } from "../src/domain/types.js";

const order = {
  id: "id-1",
  channelId: "ch-1",
  telegramChatId: "-100",
  sellerId: "owner-1",
  advertiserId: "advertiser-9",
  amountTon: "1.5",
  paymentComment: "AdOrder_id-1",
  status: "awaiting_payment",
  adText: null,
  paymentTxHash: null,
  lastError: null,
  createdAt: new Date("2026-09-22T00:00:00.000Z"),
  publishDeadline: null,
  settledAt: null,
} satisfies Order;

function orderRow(status: string): Record<string, unknown> {
  return {
    id: order.id,
    channel_id: order.channelId,
    telegram_chat_id: order.telegramChatId,
    seller_id: order.sellerId,
    advertiser_id: order.advertiserId,
    amount_ton: order.amountTon,
    payment_comment: order.paymentComment,
    status,
    ad_text: null,
    payment_tx_hash: null,
    last_error: null,
    created_at: order.createdAt.toISOString(),
    publish_deadline: null,
    settled_at: null,
  };
}

describe("postgres security guards", () => {
  it("updates an order only from the expected statuses and maps a reused transaction", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const db: SqlQueryable = {
      async query(text, values) {
        calls.push({ text, values });
        if (text.includes("UPDATE orders")) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes("WHERE id = $1")) {
          return { rows: [orderRow("released")], rowCount: 1 };
        }
        const error = Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "orders_payment_tx_hash_key",
        });
        throw error;
      },
    };
    const store = new PostgresStore(db);
    await expect(
      store.updateOrder(order.id, { status: "escrow_locked", paymentTxHash: "tx-1" }, { expectedStatuses: ["awaiting_payment"] }),
    ).rejects.toMatchObject({ code: "ALREADY_SETTLED" });
    expect(calls[1]?.text).toContain("status = ANY");
    expect(calls[1]?.values?.[7]).toEqual(["awaiting_payment"]);
    expect(calls[0]?.text).not.toContain("FOR UPDATE");

    const locking = new PostgresStore({
      async query(text) {
        if (text.includes("FOR UPDATE")) {
          return { rows: [orderRow("awaiting_payment")], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    const lockedRead = await locking.getOrderByPaymentComment(order.paymentComment, { forUpdate: true });
    expect(lockedRead?.id).toBe(order.id);

    await expect(store.saveOrder(order)).rejects.toMatchObject({ code: "PAYMENT_REUSED" });
  });

  it("settles escrow only while the receipt is locked", async () => {
    const scripts: string[] = [];
    const db: SqlQueryable = {
      async query(text) {
        scripts.push(text);
        if (text.includes("UPDATE escrow_receipts")) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            {
              order_id: "id-1",
              status: "released",
              amount_ton: "1",
              seller_id: "s",
              advertiser_id: "a",
              payment_ref: "tx",
              settled_at: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      },
    };
    const escrow = new PostgresEscrow(db);
    await expect(escrow.releaseToSeller("id-1")).rejects.toMatchObject({ code: "ALREADY_SETTLED" });
    expect(scripts[0]).toContain("status = 'locked'");
  });

  it("routes a transaction through one client and rolls back on failure", async () => {
    const events: string[] = [];
    const client = {
      async query(text: string) {
        events.push(`c:${text}`);
        return { rows: [], rowCount: 0 } satisfies SqlResult;
      },
      release() {
        events.push("release");
      },
    };
    const db = new PgDatabase({
      async query(text) {
        events.push(`p:${text}`);
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        events.push("connect");
        return client;
      },
    });

    await db.query("SELECT 1");
    await db.transaction(async () => {
      await db.transaction(async () => {
        await db.query("SELECT inside");
      });
    });
    await expect(
      db.transaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(events).toEqual([
      "p:SELECT 1",
      "connect",
      "c:BEGIN",
      "c:SELECT inside",
      "c:COMMIT",
      "release",
      "connect",
      "c:BEGIN",
      "c:ROLLBACK",
      "release",
    ]);
  });

  it("skips a constraint when existing rows would violate it and applies a clean one", async () => {
    const applied: string[] = [];
    const logs: string[] = [];
    const db: SqlQueryable = {
      async query(text, values) {
        if (text.includes("pg_constraint") || text.includes("pg_indexes")) {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("SELECT count")) {
          const dirty = text.includes("member_count");
          return { rows: [{ n: dirty ? 2 : 0 }], rowCount: 1 };
        }
        applied.push(text);
        return { rows: [], rowCount: values ? 1 : 0 };
      },
    };
    const names = await applyAdditiveConstraints(db, (line) => logs.push(line));
    expect(names).toHaveLength(MIGRATION_STEPS.length - 1);
    expect(names).not.toContain("channels_member_count_check");
    expect(logs.join(" ")).toContain("Skipped channels_member_count_check");
    expect(applied.some((sql) => sql.includes("orders_status_check"))).toBe(true);
  });

  it("keeps the process alive when an idle pool client errors", async () => {
    const pool = createPostgresPool("postgres://user:secret@127.0.0.1:1/ton_ads");
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });
    expect(() => pool.emit("error", new Error("connect ETIMEDOUT postgres://user:secret@host/db"))).not.toThrow();
    expect(errors.join(" ")).not.toContain("secret");
    expect(errors.join(" ")).toContain("postgres://[redacted]");
    spy.mockRestore();
    await pool.end();
  });
});
