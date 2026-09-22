import { MarketplaceError, orderStatusConflict } from "../domain/errors.js";
import type { ChannelUpdate, MarketplaceStore, OrderPatch, ReadOptions, UpdateOrderOptions } from "../domain/store.js";
import type { Channel, Order, OrderStatus } from "../domain/types.js";

function sameHandle(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export class InMemoryStore implements MarketplaceStore {
  private readonly channels = new Map<string, Channel>();
  private readonly orders = new Map<string, Order>();

  async saveChannel(channel: Channel): Promise<Channel> {
    for (const existing of this.channels.values()) {
      if (sameHandle(existing.handle, channel.handle)) {
        throw new MarketplaceError("CHANNEL_TAKEN", "That channel is already listed.");
      }
    }
    this.channels.set(channel.id, { ...channel });
    return { ...channel };
  }

  async updateChannel(id: string, patch: ChannelUpdate): Promise<Channel> {
    const current = this.channels.get(id);
    if (!current) {
      throw new MarketplaceError("CHANNEL_NOT_FOUND", "That channel is not listed.");
    }
    const next = { ...current, ...patch };
    this.channels.set(id, next);
    return { ...next };
  }

  async listChannels(): Promise<Channel[]> {
    return [...this.channels.values()].map((channel) => ({ ...channel }));
  }

  async getChannel(id: string): Promise<Channel | null> {
    const channel = this.channels.get(id);
    return channel ? { ...channel } : null;
  }

  async getChannelByHandle(handle: string): Promise<Channel | null> {
    const found = [...this.channels.values()].find((channel) => sameHandle(channel.handle, handle));
    return found ? { ...found } : null;
  }

  async saveOrder(order: Order): Promise<Order> {
    this.orders.set(order.id, { ...order });
    return { ...order };
  }

  async getOrder(id: string, _options?: ReadOptions): Promise<Order | null> {
    const order = this.orders.get(id);
    return order ? { ...order } : null;
  }

  async getOrderByPaymentComment(comment: string, _options?: ReadOptions): Promise<Order | null> {
    const order = [...this.orders.values()].find((candidate) => candidate.paymentComment === comment);
    return order ? { ...order } : null;
  }

  async getOrderByPaymentTxHash(txHash: string, _options?: ReadOptions): Promise<Order | null> {
    const order = [...this.orders.values()].find((candidate) => candidate.paymentTxHash === txHash);
    return order ? { ...order } : null;
  }

  async listOrdersByStatuses(statuses: OrderStatus[]): Promise<Order[]> {
    const wanted = new Set(statuses);
    return [...this.orders.values()].filter((order) => wanted.has(order.status)).map((order) => ({ ...order }));
  }

  async updateOrder(id: string, patch: OrderPatch, options?: UpdateOrderOptions): Promise<Order> {
    const current = this.orders.get(id);
    if (!current) {
      throw new MarketplaceError("ORDER_NOT_FOUND", "Order not found.");
    }
    if (options?.expectedStatuses && !options.expectedStatuses.includes(current.status)) {
      throw orderStatusConflict(current.status);
    }
    const next = { ...current, ...patch };
    this.orders.set(id, next);
    return { ...next };
  }
}
