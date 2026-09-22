import { randomUUID } from "node:crypto";
import { sanitizeForLog } from "../log.js";
import type { EscrowPort } from "./escrow.js";
import { MarketplaceError, orderStatusConflict } from "./errors.js";
import { assertPositivePrice, parseTon } from "./money.js";
import type { MarketplaceStore } from "./store.js";
import type {
  AdPublisher,
  Channel,
  CreateOrderInput,
  EscrowReceipt,
  MatchPaymentInput,
  Order,
  RegisterChannelInput,
  SubmitAdInput,
} from "./types.js";

export const DEFAULT_ORDER_TIMEOUT_MS = 60 * 60 * 1000;
export const MAX_AD_TEXT_LENGTH = 3500;

export type TransactionRunner = {
  transaction<T>(work: () => Promise<T>): Promise<T>;
};

export type MarketplaceOptions = {
  store: MarketplaceStore;
  escrow: EscrowPort;
  now?: () => Date;
  orderTimeoutMs?: number;
  idGenerator?: () => string;
  transactions?: TransactionRunner;
};

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed.startsWith("@") || trimmed.length < 2 || /\s/.test(trimmed)) {
    throw new MarketplaceError(
      "INVALID_HANDLE",
      "Send a public channel handle starting with @ (for example @mychannel).",
    );
  }
  return `@${trimmed.slice(1).toLowerCase()}`;
}

export class Marketplace {
  private readonly store: MarketplaceStore;
  private readonly escrow: EscrowPort;
  private readonly now: () => Date;
  private readonly orderTimeoutMs: number;
  private readonly idGenerator: () => string;
  private readonly transactions?: TransactionRunner;

  constructor(options: MarketplaceOptions) {
    this.store = options.store;
    this.escrow = options.escrow;
    this.now = options.now ?? (() => new Date());
    this.orderTimeoutMs = options.orderTimeoutMs ?? DEFAULT_ORDER_TIMEOUT_MS;
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
    this.transactions = options.transactions;
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
    const ownerId = String(input.ownerId);
    const patch = {
      title: input.title.trim() || handle,
      telegramChatId: String(input.telegramChatId),
      memberCount: input.memberCount,
      priceTon,
    };
    const existing = await this.store.getChannelByHandle(handle);
    if (existing) {
      if (existing.ownerId !== ownerId) {
        throw new MarketplaceError("CHANNEL_TAKEN", "That channel is already listed by another owner.");
      }
      return this.store.updateChannel(existing.id, patch);
    }
    const channel: Channel = {
      id: this.idGenerator(),
      handle,
      ownerId,
      createdAt: this.now(),
      ...patch,
    };
    try {
      return await this.store.saveChannel(channel);
    } catch (error) {
      if (!(error instanceof MarketplaceError) || error.code !== "CHANNEL_TAKEN") {
        throw error;
      }
      const raced = await this.store.getChannelByHandle(handle);
      if (raced && raced.ownerId === ownerId) {
        return this.store.updateChannel(raced.id, patch);
      }
      throw error;
    }
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
    const txHash = input.txHash?.trim() ?? "";
    if (!txHash || txHash === "[object Object]") {
      throw new MarketplaceError("INVALID_PAYMENT", "Payment transaction hash is missing.");
    }
    const advertiserId = String(input.advertiserId);
    return this.runInTransaction(async () => {
      const duplicate = await this.store.getOrderByPaymentTxHash(txHash, { forUpdate: true });
      if (duplicate) {
        if (duplicate.paymentComment === input.paymentComment && duplicate.advertiserId === advertiserId) {
          return duplicate;
        }
        if (duplicate.paymentComment === input.paymentComment) {
          throw new MarketplaceError("UNAUTHORIZED", "Only the advertiser who paid can confirm this order.");
        }
        throw new MarketplaceError("PAYMENT_REUSED", "This transaction was already matched to an order.");
      }

      const order = await this.store.getOrderByPaymentComment(input.paymentComment, { forUpdate: true });
      if (!order) {
        throw new MarketplaceError("PAYMENT_NOT_MATCHED", "No order matches that payment comment.");
      }
      if (order.advertiserId !== advertiserId) {
        throw new MarketplaceError("UNAUTHORIZED", "Only the advertiser who created this order can confirm payment.");
      }
      if (order.status !== "awaiting_payment") {
        throw orderStatusConflict(order.status);
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
        paymentRef: txHash,
      });

      return this.store.updateOrder(
        order.id,
        {
          status: "escrow_locked",
          paymentTxHash: txHash,
          publishDeadline: new Date(this.now().getTime() + this.orderTimeoutMs),
        },
        { expectedStatuses: ["awaiting_payment"] },
      );
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
    if (text.length > MAX_AD_TEXT_LENGTH) {
      throw new MarketplaceError(
        "AD_TEXT_TOO_LONG",
        `Ad text must be at most ${MAX_AD_TEXT_LENGTH} characters.`,
      );
    }
    return this.store.updateOrder(
      order.id,
      { adText: text, lastError: null },
      { expectedStatuses: ["escrow_locked", "publish_failed"] },
    );
  }

  async publish(orderId: string, publisher: AdPublisher, advertiserId: string): Promise<Order> {
    const current = await this.requireOrder(orderId);
    if (current.advertiserId !== String(advertiserId)) {
      throw new MarketplaceError("UNAUTHORIZED", "Only the advertiser who paid can publish this order.");
    }

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
      return this.store.updateOrder(
        order.id,
        {
          status: "publish_failed",
          lastError: result.error,
        },
        { expectedStatuses: ["escrow_locked", "publish_failed"] },
      );
    }

    return this.runInTransaction(async () => {
      await this.settleOrAccept(order.id, "released");
      return this.store.updateOrder(
        order.id,
        {
          status: "released",
          lastError: null,
          settledAt: this.now(),
        },
        { expectedStatuses: ["escrow_locked", "publish_failed"] },
      );
    });
  }

  async refundOrder(orderId: string): Promise<Order> {
    return this.runInTransaction(async () => {
      const order = await this.requireOrder(orderId, true);
      if (order.status === "refunded" || order.status === "expired") {
        return order;
      }
      if (order.status === "released") {
        throw new MarketplaceError("ALREADY_SETTLED", "Released funds cannot be refunded.");
      }
      if (order.status === "awaiting_payment") {
        return this.store.updateOrder(
          order.id,
          {
            status: "expired",
            settledAt: this.now(),
          },
          { expectedStatuses: ["awaiting_payment"] },
        );
      }

      await this.settleOrAccept(order.id, "refunded");
      return this.store.updateOrder(
        order.id,
        {
          status: "refunded",
          settledAt: this.now(),
        },
        { expectedStatuses: ["escrow_locked", "publish_failed"] },
      );
    });
  }

  async refundExpiredOrders(): Promise<Order[]> {
    const open = await this.store.listOrdersByStatuses(["escrow_locked", "publish_failed"]);
    const refunded: Order[] = [];
    for (const order of open) {
      try {
        const next = await this.refundIfTimedOut(order.id);
        if (next) {
          refunded.push(next);
        }
      } catch (error) {
        console.error(`Timeout refund failed for order ${order.id}: ${sanitizeForLog(error)}`);
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

  private async requireOrder(orderId: string, forUpdate = false): Promise<Order> {
    const order = await this.store.getOrder(orderId, forUpdate ? { forUpdate: true } : undefined);
    if (!order) {
      throw new MarketplaceError("ORDER_NOT_FOUND", "Order not found.");
    }
    return order;
  }

  private async settleOrAccept(orderId: string, status: "released" | "refunded"): Promise<void> {
    try {
      if (status === "released") {
        await this.escrow.releaseToSeller(orderId);
      } else {
        await this.escrow.refundToAdvertiser(orderId);
      }
    } catch (error) {
      if (!(error instanceof MarketplaceError) || error.code !== "ALREADY_SETTLED") {
        throw error;
      }
      const receipt = await this.readReceipt(orderId);
      if (receipt?.status !== status) {
        throw error;
      }
    }
  }

  private async readReceipt(orderId: string): Promise<EscrowReceipt | null> {
    try {
      return await this.escrow.get(orderId);
    } catch (error) {
      if (error instanceof MarketplaceError && error.code === "ESCROW_READ_UNAVAILABLE") {
        return null;
      }
      throw error;
    }
  }

  private async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.transactions) {
      return this.transactions.transaction(work);
    }
    return work();
  }
}
