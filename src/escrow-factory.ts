import { PostgresEscrow } from "./adapters/postgres-escrow.js";
import { TonContractEscrow } from "./adapters/ton-contract-escrow.js";
import type { AppConfig } from "./config.js";
import type { EscrowPort } from "./domain/escrow.js";
import type { SqlQueryable } from "./db/sql.js";

/**
 * Live escrow selection. Unset ESCROW_MODE stays on PostgresEscrow.
 * ton_testnet returns an adapter that throws instead of broadcasting.
 */
export function createLiveEscrow(config: AppConfig, db: SqlQueryable): EscrowPort {
  if (config.escrowMode === "ton_testnet") {
    return new TonContractEscrow({
      contractAddress: config.escrowContractAddress,
      endpoint: config.toncenterApiUrl,
    });
  }
  return new PostgresEscrow(db);
}
