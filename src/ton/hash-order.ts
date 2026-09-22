import { sha256 } from "@ton/crypto";

/** On-chain deal key: sha256(utf8 order id) as a 256-bit integer. */
export async function hashOrderId(orderId: string): Promise<bigint> {
  const digest = await sha256(Buffer.from(orderId, "utf8"));
  return BigInt(`0x${Buffer.from(digest).toString("hex")}`);
}
