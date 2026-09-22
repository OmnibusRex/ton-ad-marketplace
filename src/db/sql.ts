export type SqlResult = {
  rows: Record<string, unknown>[];
  rowCount: number | null;
};

export type SqlQueryable = {
  query(text: string, values?: unknown[]): Promise<SqlResult>;
};

export type TxClient = SqlQueryable;

export type DbConnection = SqlQueryable & {
  transaction<T>(work: () => Promise<T>): Promise<T>;
};
