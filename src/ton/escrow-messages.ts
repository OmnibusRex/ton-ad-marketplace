import { Address, beginCell, Cell } from "@ton/core";
import { TON_ESCROW_OP } from "./opcodes.js";

export function cellToBase64(cell: Cell): string {
  return cell.toBoc().toString("base64");
}

/** deposit body: op, query_id, order_id_hash, seller, deadline. Amount is the attached value, not a field. */
export function buildDepositBody(
  orderIdHash: bigint,
  seller: Address,
  deadlineUnix: bigint,
  queryId = 0n,
): Cell {
  return beginCell()
    .storeUint(TON_ESCROW_OP.deposit, 32)
    .storeUint(queryId, 64)
    .storeUint(orderIdHash, 256)
    .storeAddress(seller)
    .storeUint(deadlineUnix, 64)
    .endCell();
}

export function buildSettleBody(op: number, orderIdHash: bigint, queryId = 0n): Cell {
  return beginCell()
    .storeUint(op, 32)
    .storeUint(queryId, 64)
    .storeUint(orderIdHash, 256)
    .endCell();
}

export function buildReleaseBody(orderIdHash: bigint, queryId = 0n): Cell {
  return buildSettleBody(TON_ESCROW_OP.release, orderIdHash, queryId);
}

export function buildRefundBody(orderIdHash: bigint, queryId = 0n): Cell {
  return buildSettleBody(TON_ESCROW_OP.refund, orderIdHash, queryId);
}
