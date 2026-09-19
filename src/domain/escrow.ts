import { MarketplaceError } from "./errors.js";
import type { EscrowReceipt } from "./types.js";

/**
 * Custody operations for one ad order.
 *
 * The marketplace never talks to TON directly. `contracts/escrow.fc` is an
 * unaudited testnet skeleton for lock / release / refund. `TonContractEscrow`
 * implements this port but throws until wired. The in-process ledger shipped
 * here is application-level escrow, not production-safe on-chain settlement.
 */
export type LockEscrowInput = {
  orderId: string;
  sellerId: string;
  advertiserId: string;
  amountTon: string;
  paymentRef: string;
};

export interface EscrowPort {
  lock(input: LockEscrowInput): Promise<EscrowReceipt>;
  releaseToSeller(orderId: string): Promise<EscrowReceipt>;
  refundToAdvertiser(orderId: string): Promise<EscrowReceipt>;
  get(orderId: string): Promise<EscrowReceipt | null>;
}

export class InMemoryEscrow implements EscrowPort {
  private readonly receipts = new Map<string, EscrowReceipt>();

  async lock(input: LockEscrowInput): Promise<EscrowReceipt> {
    const existing = this.receipts.get(input.orderId);
    if (existing) {
      throw new MarketplaceError("ALREADY_LOCKED", `Escrow already exists for order ${input.orderId}`);
    }
    const receipt: EscrowReceipt = {
      orderId: input.orderId,
      status: "locked",
      amountTon: input.amountTon,
      sellerId: input.sellerId,
      advertiserId: input.advertiserId,
      paymentRef: input.paymentRef,
      settledAt: null,
    };
    this.receipts.set(input.orderId, receipt);
    return receipt;
  }

  async releaseToSeller(orderId: string): Promise<EscrowReceipt> {
    const receipt = this.requireLocked(orderId);
    const released: EscrowReceipt = {
      ...receipt,
      status: "released",
      settledAt: new Date(),
    };
    this.receipts.set(orderId, released);
    return released;
  }

  async refundToAdvertiser(orderId: string): Promise<EscrowReceipt> {
    const receipt = this.requireLocked(orderId);
    const refunded: EscrowReceipt = {
      ...receipt,
      status: "refunded",
      settledAt: new Date(),
    };
    this.receipts.set(orderId, refunded);
    return refunded;
  }

  async get(orderId: string): Promise<EscrowReceipt | null> {
    return this.receipts.get(orderId) ?? null;
  }

  sellerWasPaid(orderId: string): boolean {
    return this.receipts.get(orderId)?.status === "released";
  }

  advertiserWasRefunded(orderId: string): boolean {
    return this.receipts.get(orderId)?.status === "refunded";
  }

  private requireLocked(orderId: string): EscrowReceipt {
    const receipt = this.receipts.get(orderId);
    if (!receipt) {
      throw new MarketplaceError("NOT_LOCKED", `No escrow lock for order ${orderId}`);
    }
    if (receipt.status !== "locked") {
      throw new MarketplaceError("ALREADY_SETTLED", `Escrow for ${orderId} is already ${receipt.status}`);
    }
    return receipt;
  }
}
