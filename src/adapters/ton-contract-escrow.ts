import { sha256 } from "@ton/crypto";
import { MarketplaceError } from "../domain/errors.js";
import type { EscrowPort, LockEscrowInput } from "../domain/escrow.js";
import type { EscrowReceipt } from "../domain/types.js";

/**
 * Opcodes in `contracts/escrow.fc`. Keep these in lockstep with the FunC
 * constants (`op::deposit` / `op::release` / `op::refund`).
 */
export const TON_ESCROW_OP = {
  deposit: 1,
  release: 2,
  refund: 3,
} as const;

export const TON_ESCROW_STATUS = {
  locked: 1,
  released: 2,
  refunded: 3,
} as const;

export type TonContractEscrowOptions = {
  /** Testnet contract address once a human deploys the skeleton. Unused until wired. */
  contractAddress?: string;
  /** Toncenter (or compatible) HTTP endpoint. Unused until wired. */
  endpoint?: string;
};

const NOT_WIRED =
  "TonContractEscrow is a stub until a testnet contract is deployed and this adapter is wired. " +
  "The live bot and product tests keep using PostgresEscrow / InMemoryEscrow. " +
  "This adapter does not broadcast TON and must not be treated as custody.";

/**
 * Future on-chain adapter for {@link EscrowPort}.
 *
 * Mapping to `contracts/escrow.fc` (UNAUDITED, testnet-only):
 * - `lock` → `op::deposit` (advertiser TON bound to sha256(orderId))
 * - `releaseToSeller` → `op::release` (operator publish-success signal)
 * - `refundToAdvertiser` → `op::refund` (timeout or publish-failure)
 * - `get` → `get_deal`
 *
 * Methods throw `ESCROW_NOT_WIRED` so the product loop cannot accidentally
 * treat this class as live settlement. Do not pass mnemonics into this type.
 */
export class TonContractEscrow implements EscrowPort {
  constructor(private readonly options: TonContractEscrowOptions = {}) {}

  async lock(_input: LockEscrowInput): Promise<EscrowReceipt> {
    this.throwNotWired();
  }

  async releaseToSeller(_orderId: string): Promise<EscrowReceipt> {
    this.throwNotWired();
  }

  async refundToAdvertiser(_orderId: string): Promise<EscrowReceipt> {
    this.throwNotWired();
  }

  async get(_orderId: string): Promise<EscrowReceipt | null> {
    this.throwNotWired();
  }

  private throwNotWired(): never {
    void this.options;
    throw new MarketplaceError("ESCROW_NOT_WIRED", NOT_WIRED);
  }
}

/** On-chain deal key: sha256(utf8 order id) as a 256-bit integer. */
export async function hashOrderId(orderId: string): Promise<bigint> {
  const digest = await sha256(Buffer.from(orderId, "utf8"));
  return BigInt("0x" + Buffer.from(digest).toString("hex"));
}
