import { Address } from "@ton/core";
import { MarketplaceError } from "../domain/errors.js";
import type { EscrowPort, LockEscrowInput } from "../domain/escrow.js";
import type { EscrowReceipt } from "../domain/types.js";
import { hashOrderId } from "../ton/hash-order.js";
import { assertTestnetEndpoint } from "../ton/network.js";
import { buildRefundBody, buildReleaseBody, cellToBase64 } from "../ton/escrow-messages.js";

export { hashOrderId };
export { TON_ESCROW_OP, TON_ESCROW_STATUS } from "../ton/opcodes.js";

export type TonContractEscrowOptions = {
  /** Testnet contract address once a human deploys the skeleton. */
  contractAddress?: string;
  /** Toncenter (or compatible) HTTP endpoint. Never called by this adapter. */
  endpoint?: string;
};

const NOT_WIRED =
  "TonContractEscrow is not the live escrow. Set ESCROW_MODE=postgres (the default) " +
  "or configure a testnet contract explicitly. This adapter does not broadcast TON.";

const NOT_SIGNED =
  "On-chain escrow action was not broadcast. This process never signs or sends TON. " +
  "Sign the testnet message yourself if you mean to send it. See docs/TESTNET_ESCROW.md.";

/**
 * Fail-closed error for an unsigned testnet message.
 * `unsignedBoc` is kept off enumerable copies so Telegram replies (error.message)
 * and JSON logs do not include the body.
 */
export class EscrowNotSignedError extends MarketplaceError {
  declare readonly unsignedBoc?: string;

  constructor(message = NOT_SIGNED, unsignedBoc?: string) {
    super("ESCROW_NOT_SIGNED", message);
    this.name = "EscrowNotSignedError";
    if (unsignedBoc !== undefined) {
      Object.defineProperty(this, "unsignedBoc", {
        value: unsignedBoc,
        enumerable: false,
        writable: false,
      });
    }
  }
}

/**
 * Testnet EscrowPort that refuses to broadcast.
 *
 * `lock` cannot build a safe deposit until the seller has a TON payout address
 * (today sellers are Telegram ids), so it fails before a body exists.
 * `releaseToSeller` / `refundToAdvertiser` prepare an unsigned body and throw.
 * `get` does not call the network unless a test injected a reader.
 */
export class TonContractEscrow implements EscrowPort {
  private readonly contractAddress?: Address;
  private readonly reader?: (orderId: string) => Promise<EscrowReceipt | null>;

  constructor(
    options: TonContractEscrowOptions = {},
    reader?: (orderId: string) => Promise<EscrowReceipt | null>,
  ) {
    if (options.endpoint) {
      assertTestnetEndpoint(options.endpoint);
    }
    if (options.contractAddress) {
      this.contractAddress = Address.parse(options.contractAddress);
    }
    this.reader = reader;
  }

  async lock(_input: LockEscrowInput): Promise<EscrowReceipt> {
    this.assertConfigured();
    throw new EscrowNotSignedError(
      "On-chain lock was not broadcast. Seller payout is still a Telegram id, not a TON address, so no deposit was created or sent. See docs/TESTNET_ESCROW.md.",
    );
  }

  async releaseToSeller(orderId: string): Promise<EscrowReceipt> {
    return this.refuseSettle(orderId, buildReleaseBody);
  }

  async refundToAdvertiser(orderId: string): Promise<EscrowReceipt> {
    return this.refuseSettle(orderId, buildRefundBody);
  }

  async get(orderId: string): Promise<EscrowReceipt | null> {
    this.assertConfigured();
    if (!this.reader) {
      throw new MarketplaceError(
        "ESCROW_READ_UNAVAILABLE",
        "On-chain escrow reads are disabled. This adapter does not call the network.",
      );
    }
    return this.reader(orderId);
  }

  private assertConfigured(): void {
    if (!this.contractAddress) {
      throw new MarketplaceError("ESCROW_NOT_WIRED", NOT_WIRED);
    }
  }

  private async refuseSettle(
    orderId: string,
    build: (orderIdHash: bigint) => import("@ton/core").Cell,
  ): Promise<EscrowReceipt> {
    this.assertConfigured();
    const body = build(await hashOrderId(orderId));
    throw new EscrowNotSignedError(NOT_SIGNED, cellToBase64(body));
  }
}
