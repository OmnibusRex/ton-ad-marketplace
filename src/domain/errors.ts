import type { OrderStatus } from "./types.js";

export class MarketplaceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MarketplaceError";
  }
}

export function orderStatusConflict(status: OrderStatus): MarketplaceError {
  if (status === "escrow_locked" || status === "publish_failed") {
    return new MarketplaceError("ALREADY_LOCKED", "This order already has locked funds.");
  }
  if (status === "released" || status === "refunded" || status === "expired") {
    return new MarketplaceError("ALREADY_SETTLED", `Order is already ${status}.`);
  }
  return new MarketplaceError("ORDER_CONFLICT", `Order status ${status} did not match the expected update.`);
}
