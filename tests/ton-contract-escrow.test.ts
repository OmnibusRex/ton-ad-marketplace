import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryEscrow } from "../src/domain/escrow.js";
import { MarketplaceError } from "../src/domain/errors.js";
import { Marketplace } from "../src/domain/marketplace.js";
import { InMemoryStore } from "../src/adapters/memory-store.js";
import {
  hashOrderId,
  TON_ESCROW_OP,
  TON_ESCROW_STATUS,
  TonContractEscrow,
} from "../src/adapters/ton-contract-escrow.js";

const funcSource = readFileSync(join(process.cwd(), "contracts/escrow.fc"), "utf8");

describe("TonContractEscrow adapter stub", () => {
  it("implements EscrowPort and throws until a testnet contract is wired", async () => {
    const escrow = new TonContractEscrow({
      contractAddress: "EQB_FAKE_TESTNET_ESCROW_CONTRACT_ONLY",
      endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
    });

    const lock = escrow.lock({
      orderId: "order-1",
      sellerId: "seller-1",
      advertiserId: "advertiser-1",
      amountTon: "1.5",
      paymentRef: "tx-abc",
    });
    await expect(lock).rejects.toBeInstanceOf(MarketplaceError);
    await expect(lock).rejects.toMatchObject({ code: "ESCROW_NOT_WIRED" });
    await expect(escrow.releaseToSeller("order-1")).rejects.toMatchObject({ code: "ESCROW_NOT_WIRED" });
    await expect(escrow.refundToAdvertiser("order-1")).rejects.toMatchObject({ code: "ESCROW_NOT_WIRED" });
    await expect(escrow.get("order-1")).rejects.toMatchObject({ code: "ESCROW_NOT_WIRED" });
  });

  it("hashes order ids deterministically for the FunC uint256 key", async () => {
    const first = await hashOrderId("id-1");
    const second = await hashOrderId("id-1");
    const other = await hashOrderId("id-2");
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first.toString(16).length).toBeGreaterThan(0);
  });

  it("keeps FunC opcodes aligned with the TypeScript adapter", () => {
    expect(funcSource).toContain("UNAUDITED");
    expect(funcSource).toContain("TESTNET ONLY");
    expect(funcSource).toContain("DO NOT DEPLOY TO MAINNET");
    expect(funcSource).toMatch(/const int op::deposit = 1;/);
    expect(funcSource).toMatch(/const int op::release = 2;/);
    expect(funcSource).toMatch(/const int op::refund = 3;/);
    expect(TON_ESCROW_OP).toEqual({ deposit: 1, release: 2, refund: 3 });
    expect(TON_ESCROW_STATUS).toEqual({ locked: 1, released: 2, refunded: 3 });
  });

  it("leaves the product loop on in-memory escrow, not the contract stub", async () => {
    const store = new InMemoryStore();
    const escrow = new InMemoryEscrow();
    const marketplace = new Marketplace({
      store,
      escrow,
      now: () => new Date("2026-09-18T00:00:00.000Z"),
      idGenerator: () => "id-loop",
    });

    const channel = await marketplace.registerChannel({
      handle: "@newsdesk",
      title: "News Desk",
      ownerId: "owner-1",
      telegramChatId: "-1001",
      memberCount: 10,
      priceTon: "1",
      botIsAdmin: true,
    });
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "1",
      txHash: "tx-loop",
    });
    await marketplace.submitAdCopy({
      orderId: order.id,
      advertiserId: "advertiser-9",
      text: "Hello channel",
    });
    const published = await marketplace.publish(order.id, {
      async publish() {
        return { ok: true };
      },
    });

    expect(published.status).toBe("released");
    expect(escrow.sellerWasPaid(order.id)).toBe(true);
    expect(escrow).toBeInstanceOf(InMemoryEscrow);
  });
});
