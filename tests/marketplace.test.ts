import { describe, expect, it } from "vitest";
import { InMemoryEscrow } from "../src/domain/escrow.js";
import { MarketplaceError } from "../src/domain/errors.js";
import { Marketplace } from "../src/domain/marketplace.js";
import { InMemoryStore } from "../src/adapters/memory-store.js";
import type { AdPublisher } from "../src/domain/types.js";

const START = new Date("2026-09-18T00:00:00.000Z");

function successfulPublisher(): AdPublisher {
  return {
    async publish() {
      return { ok: true };
    },
  };
}

function failingPublisher(error = "bot was removed from the channel"): AdPublisher {
  return {
    async publish() {
      return { ok: false, error };
    },
  };
}

function setup(timeoutMs = 60_000) {
  const store = new InMemoryStore();
  const escrow = new InMemoryEscrow();
  let now = new Date(START);
  let n = 0;
  const marketplace = new Marketplace({
    store,
    escrow,
    now: () => now,
    orderTimeoutMs: timeoutMs,
    idGenerator: () => `id-${++n}`,
  });
  return {
    store,
    escrow,
    marketplace,
    setNow(next: Date) {
      now = next;
    },
  };
}

async function listedChannel(
  marketplace: Marketplace,
  overrides: Partial<{
    handle: string;
    title: string;
    ownerId: string;
    telegramChatId: string;
    memberCount: number;
    priceTon: string;
  }> = {},
) {
  return marketplace.registerChannel({
    handle: overrides.handle ?? "@newsdesk",
    title: overrides.title ?? "News Desk",
    ownerId: overrides.ownerId ?? "owner-1",
    telegramChatId: overrides.telegramChatId ?? "-1001",
    memberCount: overrides.memberCount ?? 1200,
    priceTon: overrides.priceTon ?? "1.5",
    botIsAdmin: true,
  });
}

describe("seller-priced ad marketplace", () => {
  it("lists registered channels with verified member count and owner-set price", async () => {
    const { marketplace } = setup();
    await listedChannel(marketplace, {
      handle: "@small",
      title: "Small",
      memberCount: 10,
      priceTon: "0.2",
    });
    await listedChannel(marketplace, {
      handle: "@big",
      title: "Big",
      memberCount: 5000,
      priceTon: "3",
    });

    const listed = await marketplace.listChannels();
    expect(listed.map((channel) => channel.handle)).toEqual(["@big", "@small"]);
    expect(listed[0]).toMatchObject({
      title: "Big",
      memberCount: 5000,
      priceTon: "3",
    });
    expect(listed[1]).toMatchObject({
      memberCount: 10,
      priceTon: "0.2",
    });
  });

  it("rejects a listing when the bot is not an admin", async () => {
    const { marketplace } = setup();
    await expect(
      marketplace.registerChannel({
        handle: "@locked",
        title: "Locked",
        ownerId: "owner-1",
        telegramChatId: "-1002",
        memberCount: 10,
        priceTon: "1",
        botIsAdmin: false,
      }),
    ).rejects.toMatchObject({ code: "BOT_NOT_ADMIN" });
    expect(await marketplace.listChannels()).toEqual([]);
  });

  it("matches a payment comment to one order and locks escrow without paying the owner", async () => {
    const { marketplace, escrow } = setup();
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });

    expect(order.status).toBe("awaiting_payment");
    expect(order.paymentComment).toBe(`AdOrder_${order.id}`);
    expect(order.amountTon).toBe("1.5");

    const locked = await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "1.5",
      txHash: "tx-abc",
      advertiserId: "advertiser-9",
    });

    expect(locked.status).toBe("escrow_locked");
    expect(locked.paymentTxHash).toBe("tx-abc");
    expect(escrow.sellerWasPaid(order.id)).toBe(false);
    expect((await escrow.get(order.id))?.status).toBe("locked");
  });

  it("does not match an underpayment or a reused transaction", async () => {
    const { marketplace } = setup();
    const channel = await listedChannel(marketplace);
    const first = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-1",
    });
    const second = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-2",
    });

    await expect(
      marketplace.matchPayment({
        paymentComment: first.paymentComment,
        amountTon: "1.4",
        txHash: "tx-low",
        advertiserId: "advertiser-1",
      }),
    ).rejects.toBeInstanceOf(MarketplaceError);

    await marketplace.matchPayment({
      paymentComment: first.paymentComment,
      amountTon: "1.5",
      txHash: "tx-ok",
      advertiserId: "advertiser-1",
    });

    await expect(
      marketplace.matchPayment({
        paymentComment: second.paymentComment,
        amountTon: "1.5",
        txHash: "tx-ok",
        advertiserId: "advertiser-2",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_REUSED" });
  });

  it("releases escrow to the channel owner only after a successful publish", async () => {
    const { marketplace, escrow } = setup();
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "1.5",
      txHash: "tx-abc",
      advertiserId: "advertiser-9",
    });
    await marketplace.submitAdCopy({
      orderId: order.id,
      advertiserId: "advertiser-9",
      text: "Buy widgets at example.test",
    });

    const published = await marketplace.publish(order.id, successfulPublisher(), "advertiser-9");

    expect(published.status).toBe("released");
    expect(escrow.sellerWasPaid(order.id)).toBe(true);
    expect(escrow.advertiserWasRefunded(order.id)).toBe(false);
    expect((await escrow.get(order.id))?.sellerId).toBe("owner-1");
  });

  it("does not release funds when publish fails", async () => {
    const { marketplace, escrow } = setup();
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "1.5",
      txHash: "tx-abc",
      advertiserId: "advertiser-9",
    });
    await marketplace.submitAdCopy({
      orderId: order.id,
      advertiserId: "advertiser-9",
      text: "Buy widgets at example.test",
    });

    const failed = await marketplace.publish(order.id, failingPublisher(), "advertiser-9");

    expect(failed.status).toBe("publish_failed");
    expect(failed.lastError).toContain("removed");
    expect(escrow.sellerWasPaid(order.id)).toBe(false);
    expect((await escrow.get(order.id))?.status).toBe("locked");
  });

  it("refunds a timed-out locked order without paying the owner", async () => {
    const { marketplace, escrow, setNow } = setup(60_000);
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "1.5",
      txHash: "tx-abc",
      advertiserId: "advertiser-9",
    });

    setNow(new Date(START.getTime() + 60_000));
    const refunded = await marketplace.refundExpiredOrders();

    expect(refunded).toHaveLength(1);
    expect(refunded[0].status).toBe("refunded");
    expect(escrow.sellerWasPaid(order.id)).toBe(false);
    expect(escrow.advertiserWasRefunded(order.id)).toBe(true);
  });

  it("offers a refund path after a failed publish that still does not pay the owner", async () => {
    const { marketplace, escrow } = setup();
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "1.5",
      txHash: "tx-abc",
      advertiserId: "advertiser-9",
    });
    await marketplace.submitAdCopy({
      orderId: order.id,
      advertiserId: "advertiser-9",
      text: "Buy widgets at example.test",
    });
    await marketplace.publish(order.id, failingPublisher(), "advertiser-9");

    const refunded = await marketplace.refundOrder(order.id);

    expect(refunded.status).toBe("refunded");
    expect(escrow.sellerWasPaid(order.id)).toBe(false);
    expect(escrow.advertiserWasRefunded(order.id)).toBe(true);
  });

  it("does not accept ad copy or publish before payment is locked", async () => {
    const { marketplace } = setup();
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });

    await expect(
      marketplace.submitAdCopy({
        orderId: order.id,
        advertiserId: "advertiser-9",
        text: "too soon",
      }),
    ).rejects.toMatchObject({ code: "NOT_LOCKED" });

    await expect(marketplace.publish(order.id, successfulPublisher(), "advertiser-9")).rejects.toMatchObject({
      code: "NOT_LOCKED",
    });
  });

  it("lets the same owner update a price and rejects another owner", async () => {
    const { marketplace } = setup();
    const first = await listedChannel(marketplace, { handle: "@NewsDesk", priceTon: "1" });
    expect(first.handle).toBe("@newsdesk");

    const updated = await listedChannel(marketplace, { handle: "@newsdesk", priceTon: "2.5", memberCount: 20 });
    expect(updated.id).toBe(first.id);
    expect(updated.priceTon).toBe("2.5");
    expect(await marketplace.listChannels()).toHaveLength(1);

    await expect(listedChannel(marketplace, { handle: "@newsdesk", ownerId: "owner-2" })).rejects.toMatchObject({
      code: "CHANNEL_TAKEN",
    });
  });

  it("does not let a stranger publish or trigger a timeout refund", async () => {
    const { marketplace, escrow, setNow } = setup(60_000);
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "1.5",
      txHash: "tx-abc",
      advertiserId: "advertiser-9",
    });
    setNow(new Date(START.getTime() + 60_000));

    await expect(marketplace.publish(order.id, successfulPublisher(), "stranger")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect((await escrow.get(order.id))?.status).toBe("locked");

    const refunded = await marketplace.refundExpiredOrders();
    expect(refunded).toHaveLength(1);
    expect(refunded[0].status).toBe("refunded");
    expect(escrow.sellerWasPaid(order.id)).toBe(false);
  });

  it("confirms the same transaction twice for the same advertiser without a second lock", async () => {
    const { marketplace, escrow } = setup();
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    const first = await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "2",
      txHash: "tx-once",
      advertiserId: "advertiser-9",
    });
    const second = await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "2",
      txHash: "tx-once",
      advertiserId: "advertiser-9",
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("escrow_locked");
    expect((await escrow.get(order.id))?.amountTon).toBe("1.5");
  });

  it("rejects ad text over the length cap and a missing transaction hash", async () => {
    const { marketplace } = setup();
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    await expect(
      marketplace.matchPayment({
        paymentComment: order.paymentComment,
        amountTon: "1.5",
        txHash: "[object Object]",
        advertiserId: "advertiser-9",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT" });

    await marketplace.matchPayment({
      paymentComment: order.paymentComment,
      amountTon: "1.5",
      txHash: "tx-text",
      advertiserId: "advertiser-9",
    });
    await expect(
      marketplace.submitAdCopy({
        orderId: order.id,
        advertiserId: "advertiser-9",
        text: "a".repeat(3501),
      }),
    ).rejects.toMatchObject({ code: "AD_TEXT_TOO_LONG" });
  });

  it("rejects payment confirmation from someone other than the advertiser", async () => {
    const { marketplace } = setup();
    const channel = await listedChannel(marketplace);
    const order = await marketplace.createOrder({
      channelId: channel.id,
      advertiserId: "advertiser-9",
    });
    await expect(
      marketplace.matchPayment({
        paymentComment: order.paymentComment,
        amountTon: "1.5",
        txHash: "tx-other",
        advertiserId: "stranger",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await marketplace.getOrder(order.id)).status).toBe("awaiting_payment");
  });
});
