import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { sanitizeForLog } from "../log.js";
import type { DbConnection, SqlQueryable, SqlResult } from "./sql.js";

const { Pool } = pg;

type ConnectedClient = SqlQueryable & {
  release(): void;
};

type PoolLike = {
  query(text: string, values?: unknown[]): Promise<SqlResult>;
  connect(): Promise<ConnectedClient>;
};

function asResult(result: { rows: unknown[]; rowCount: number | null }): SqlResult {
  return {
    rows: result.rows as Record<string, unknown>[],
    rowCount: result.rowCount,
  };
}

/**
 * An idle Neon client can emit `error` (ETIMEDOUT) after the query finished.
 * Node crashes the process if that event has no listener. Log and keep going;
 * the health probe exits later if the database stays down.
 */
export function createPostgresPool(connectionString: string): pg.Pool {
  const pool = new Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 15_000,
  });
  pool.on("error", (error) => {
    console.error(`Postgres pool error (idle client): ${sanitizeForLog(error)}`);
  });
  return pool;
}

export function wrapPool(pool: pg.Pool): PgDatabase {
  return new PgDatabase({
    query: async (text, values) => asResult(await pool.query(text, values)),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (text, values) => asResult(await client.query(text, values)),
        release: () => client.release(),
      };
    },
  });
}

/**
 * Queries inside `transaction()` share one client so PostgresStore and
 * PostgresEscrow commit or roll back together. Nested calls reuse that client.
 */
export class PgDatabase implements DbConnection {
  private readonly als = new AsyncLocalStorage<SqlQueryable>();

  constructor(private readonly pool: PoolLike) {}

  async query(text: string, values?: unknown[]): Promise<SqlResult> {
    const current = this.als.getStore();
    if (current) {
      return current.query(text, values);
    }
    return this.pool.query(text, values);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) {
      return work();
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.als.run(client, work);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(`Postgres rollback failed: ${sanitizeForLog(rollbackError)}`);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
