import { MarketplaceError } from "../domain/errors.js";

type PgErrorLike = {
  code?: string;
  constraint?: string;
};

function asPgError(error: unknown): PgErrorLike | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  return error as PgErrorLike;
}

/** Map Postgres unique violations to marketplace errors. Other errors pass through. */
export function mapUniqueViolation(error: unknown): MarketplaceError | null {
  const pgError = asPgError(error);
  if (!pgError || pgError.code !== "23505") {
    return null;
  }
  const constraint = pgError.constraint ?? "";
  if (constraint.includes("payment_tx") || constraint.includes("payment_ref")) {
    return new MarketplaceError("PAYMENT_REUSED", "This transaction was already matched to an order.");
  }
  if (constraint.includes("handle")) {
    return new MarketplaceError("CHANNEL_TAKEN", "That channel is already listed.");
  }
  if (constraint.includes("payment_comment")) {
    return new MarketplaceError("ORDER_CONFLICT", "An order with that payment comment already exists.");
  }
  if (constraint.includes("escrow_receipts_pkey")) {
    return new MarketplaceError("ALREADY_LOCKED", "Escrow already exists for this order.");
  }
  return new MarketplaceError("ORDER_CONFLICT", "The database rejected a duplicate write.");
}

export async function queryMappingUnique<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const mapped = mapUniqueViolation(error);
    if (mapped) {
      throw mapped;
    }
    throw error;
  }
}
