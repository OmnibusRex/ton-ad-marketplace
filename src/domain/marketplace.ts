import { randomUUID } from "node:crypto";
import { MarketplaceError } from "./errors.js";
import type { EscrowPort } from "./escrow.js";
import { assertPositivePrice, parseTon } from "./money.js";
import type { MarketplaceStore } from "./store.js";
import type {
  AdPublisher,
  Channel,
  CreateOrderInput,
  MatchPaymentInput,
  Order,
  RegisterChannelInput,
  SubmitAdInput,
} from "./types.js";

export const DEFAULT_ORDER_TIMEOUT_MS = 60 * 60 * 1000;

export type MarketplaceOptions = {
  store: MarketplaceStore;
  escrow: EscrowPort;
  now?: () => Date;
  orderTimeoutMs?: number;
  idGenerator?: () => string;
};

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed.startsWith("@") || trimmed.length < 2) {
    throw new MarketplaceError(
      "INVALID_HANDLE",
      "Send a public channel handle starting with @ (for example @mychannel).",
    );
  }
  return trimmed;
}

export class Marketplace {
  private readonly store: MarketplaceStore;
  private readonly escrow: EscrowPort;
  private readonly now: () => Date;
  private readonly orderTimeoutMs: number;
  private readonly idGenerator: () => string;

  constructor(options: MarketplaceOptions) {
    this.store = options.store;
    this.escrow = options.escrow;
    this.now = options.now ?? (() => new Date());
    this.orderTimeoutMs = options.orderTimeoutMs ?? DEFAULT_ORDER_TIMEOUT_MS;
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
  }

  async registerChannel(input: RegisterChannelInput): Promise<Channel> {
    if (!input.botIsAdmin) {
      throw new MarketplaceError(
        "BOT_NOT_ADMIN",
        "The bot must be an admin in the channel before it can be listed.",
      );
    }
    if (!Number.isInteger(input.memberCount) || input.memberCount < 0) {
      throw new MarketplaceError("INVALID_MEMBER_COUNT", "Member count must be a non-negative integer.");
    }
    const handle = normalizeHandle(input.handle);
    const priceTon = assertPositivePrice(input.priceTon);
    const channel: Channel = {
      id: this.idGenerator(),
      handle,
      title: input.title.trim() || handle,
      telegramChatId: String(input.telegramChatId),
      ownerId: String(input.ownerId),
      memberCount: input.memberCount,
      priceTon,
      createdAt: this.now(),
    };
    return this.store.saveChannel(channel);
  }

  async listChannels(): Promise<Channel[]> {
    const channels = await this.store.listChannels();
    return [...channels].sort((a, b) => b.memberCount - a.memberCount);
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const channel = await this.store.getChannel(input.channelId);
    if (!channel) {
      throw new MarketplaceError("CHANNEL_NOT_FOUND", "That channel is not listed.");
    }
    const id = this.idGenerator();
    const order: Order = {
      id,
      channelId: channel.id,
      telegramChatId: channel.telegramChatId,
      sellerId: channel.ownerId,
      advertiserId: String(input.advertiserId),
      amountTon: channel.priceTon,
      paymentComment: `AdOrder_${id}`,
      status: "awaiting_payment",
      adText: null,
      paymentTxHash: null,
      lastError: null,
      createdAt: this.now(),
      publishDeadline: null,
      settledAt: null,
    };
    return this.store.saveOrder(order);
  }

  async matchPayment(input: MatchPaymentInput): Promise<Order> {
    const duplicate = await this.store.getOrderByPaymentTxHash(input.txHash);
    if (duplicate) {
      throw new MarketplaceError("PAYMENT_REUSED", "This transaction was already matched to an order.");
    }

    const order = await this.store.getOrderByPaymentComment(input.paymentComment);
    if (!order) {
      throw new MarketplaceError("PAYMENT_NOT_MATCHED", "No order matches that payment comment.");
    }
    if (order.status !== "awaiting_payment") {
      throw new MarketplaceError("ALREADY_LOCKED", "This order already has locked funds.");
    }

    const paid = parseTon(input.amountTon);
    const due = parseTon(order.amountTon);
    if (paid < due) {
      throw new MarketplaceError("INVALID_AMOUNT", "Paid amount is below the slot price.");
    }

    await this.escrow.lock({
      orderId: order.id,
      sellerId: order.sellerId,
      advertiserId: order.advertiserId,
      amountTon: order.amountTon,
      paymentRef: input.txHash,
    });

    return this.store.updateOrder(order.id, {
      status: "escrow_locked",
      paymentTxHash: input.txHash,
      publishDeadline: new Date(this.now().getTime() + this.orderTimeoutMs),
    });
  }

  async submitAdCopy(input: SubmitAdInput): Promise<Order> {
    const order = await this.requireOrder(input.orderId);
    if (order.advertiserId !== String(input.advertiserId)) {
      throw new MarketplaceError("UNAUTHORIZED", "Only the advertiser who paid can submit ad copy.");
    }
    if (order.status !== "escrow_locked" && order.status !== "publish_failed") {
      throw new MarketplaceError("NOT_LOCKED", "Payment must be locked in escrow before ad copy is accepted.");
    }
    const text = input.text.trim();
    if (!text) {
      throw new MarketplaceError("AD_TEXT_REQUIRED", "Ad text cannot be empty.");
    }
    return this.store.updateOrder(order.id, { adText: text, lastError: null });
  }

  async publish(orderId: string, publisher: AdPublisher): Promise<Order> {
    const timedOut = await this.refundIfTimedOut(orderId);
    if (timedOut) {
      return timedOut;
    }

    const order = await this.requireOrder(orderId);
    if (order.status === "released" || order.status === "refunded" || order.status === "expired") {
      throw new MarketplaceError("ALREADY_SETTLED", `Order is already ${order.status}.`);
    }
    if (order.status !== "escrow_locked" && order.status !== "publish_failed") {
      throw new MarketplaceError("NOT_LOCKED", "Cannot publish until payment is locked in escrow.");
    }
    if (!order.adText) {
      throw new MarketplaceError("AD_TEXT_REQUIRED", "Ad text is required before publish.");
    }

    const result = await publisher.publish(order.telegramChatId, order.adText);
    if (!result.ok) {
      return this.store.updateOrder(order.id, {
        status: "publish_failed",
        lastError: result.error,
      });
    }

    await this.escrow.releaseToSeller(order.id);
    return this.store.updateOrder(order.id, {
      status: "released",
      lastError: null,
      settledAt: this.now(),
    });
  }

  async refundOrder(orderId: string): Promise<Order> {
    const order = await this.requireOrder(orderId);
    if (order.status === "refunded" || order.status === "expired") {
      return order;
    }
    if (order.status === "released") {
      throw new MarketplaceError("ALREADY_SETTLED", "Released funds cannot be refunded.");
    }
    if (order.status === "awaiting_payment") {
      return this.store.updateOrder(order.id, {
        status: "expired",
        settledAt: this.now(),
      });
    }

    await this.escrow.refundToAdvertiser(order.id);
    return this.store.updateOrder(order.id, {
      status: "refunded",
      settledAt: this.now(),
    });
  }

  async refundExpiredOrders(): Promise<Order[]> {
    const open = await this.store.listOrdersByStatuses(["escrow_locked", "publish_failed"]);
    const refunded: Order[] = [];
    for (const order of open) {
      const next = await this.refundIfTimedOut(order.id);
      if (next) {
        refunded.push(next);
      }
    }
    return refunded;
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.requireOrder(orderId);
  }

  private async refundIfTimedOut(orderId: string): Promise<Order | null> {
    const order = await this.requireOrder(orderId);
    if (
      (order.status === "escrow_locked" || order.status === "publish_failed") &&
      order.publishDeadline &&
      this.now().getTime() >= order.publishDeadline.getTime()
    ) {
      return this.refundOrder(order.id);
    }
    return null;
  }

  private async requireOrder(orderId: string): Promise<Order> {
    const order = await this.store.getOrder(orderId);
    if (!order) {
      throw new MarketplaceError("ORDER_NOT_FOUND", "Order not found.");
    }
    return order;
  }
}
