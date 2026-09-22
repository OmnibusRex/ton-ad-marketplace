import { MarketplaceError } from "../domain/errors.js";
import type { EscrowPort, LockEscrowInput } from "../domain/escrow.js";
import type { EscrowReceipt, EscrowStatus } from "../domain/types.js";
import { queryMappingUnique } from "../db/unique-violation.js";
import type { SqlQueryable, SqlResult } from "../db/sql.js";

function mapReceipt(row: Record<string, unknown>): EscrowReceipt {
  return {
    orderId: String(row.order_id),
    status: String(row.status) as EscrowStatus,
    amountTon: String(row.amount_ton),
    sellerId: String(row.seller_id),
    advertiserId: String(row.advertiser_id),
    paymentRef: String(row.payment_ref),
    settledAt: row.settled_at ? new Date(String(row.settled_at)) : null,
  };
}

/**
 * Postgres-backed application escrow ledger.
 * Records lock / release / refund decisions. It never broadcasts TON transfers.
 */
export class PostgresEscrow implements EscrowPort {
  constructor(private readonly client: SqlQueryable) {}

  private query(text: string, values?: unknown[]): Promise<SqlResult> {
    return queryMappingUnique(() => this.client.query(text, values));
  }

  async lock(input: LockEscrowInput): Promise<EscrowReceipt> {
    const existing = await this.get(input.orderId);
    if (existing) {
      throw new MarketplaceError("ALREADY_LOCKED", `Escrow already exists for order ${input.orderId}`);
    }
    const duplicateRef = await this.query(`SELECT order_id FROM escrow_receipts WHERE payment_ref = $1`, [
      input.paymentRef,
    ]);
    if (duplicateRef.rows[0]) {
      throw new MarketplaceError("PAYMENT_REUSED", "This transaction was already matched to an order.");
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
    await this.query(
      `INSERT INTO escrow_receipts
         (order_id, status, amount_ton, seller_id, advertiser_id, payment_ref, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        receipt.orderId,
        receipt.status,
        receipt.amountTon,
        receipt.sellerId,
        receipt.advertiserId,
        receipt.paymentRef,
        receipt.settledAt,
      ],
    );
    return receipt;
  }

  async releaseToSeller(orderId: string): Promise<EscrowReceipt> {
    return this.settle(orderId, "released");
  }

  async refundToAdvertiser(orderId: string): Promise<EscrowReceipt> {
    return this.settle(orderId, "refunded");
  }

  async get(orderId: string): Promise<EscrowReceipt | null> {
    const res = await this.query(`SELECT * FROM escrow_receipts WHERE order_id = $1`, [orderId]);
    return res.rows[0] ? mapReceipt(res.rows[0]) : null;
  }

  private async settle(orderId: string, status: "released" | "refunded"): Promise<EscrowReceipt> {
    const settledAt = new Date();
    const res = await this.query(
      `UPDATE escrow_receipts
       SET status = $2, settled_at = $3
       WHERE order_id = $1 AND status = 'locked'
       RETURNING *`,
      [orderId, status, settledAt],
    );
    if (res.rows[0]) {
      return mapReceipt(res.rows[0]);
    }
    const current = await this.get(orderId);
    if (!current) {
      throw new MarketplaceError("NOT_LOCKED", `No escrow lock for order ${orderId}`);
    }
    throw new MarketplaceError("ALREADY_SETTLED", `Escrow for ${orderId} is already ${current.status}`);
  }
}
