import type { OrderPatch, MarketplaceStore } from "../domain/store.js";
import type { Channel, Order, OrderStatus } from "../domain/types.js";
import { MarketplaceError } from "../domain/errors.js";

export class InMemoryStore implements MarketplaceStore {
  private readonly channels = new Map<string, Channel>();
  private readonly orders = new Map<string, Order>();

  async saveChannel(channel: Channel): Promise<Channel> {
    this.channels.set(channel.id, { ...channel });
    return { ...channel };
  }

  async listChannels(): Promise<Channel[]> {
    return [...this.channels.values()].map((channel) => ({ ...channel }));
  }

  async getChannel(id: string): Promise<Channel | null> {
    const channel = this.channels.get(id);
    return channel ? { ...channel } : null;
  }

  async saveOrder(order: Order): Promise<Order> {
    this.orders.set(order.id, { ...order });
    return { ...order };
  }

  async getOrder(id: string): Promise<Order | null> {
    const order = this.orders.get(id);
    return order ? { ...order } : null;
  }

  async getOrderByPaymentComment(comment: string): Promise<Order | null> {
    return [...this.orders.values()].find((order) => order.paymentComment === comment) ?? null;
  }

  async getOrderByPaymentTxHash(txHash: string): Promise<Order | null> {
    return [...this.orders.values()].find((order) => order.paymentTxHash === txHash) ?? null;
  }

  async listOrdersByStatuses(statuses: OrderStatus[]): Promise<Order[]> {
    const wanted = new Set(statuses);
    return [...this.orders.values()]
      .filter((order) => wanted.has(order.status))
      .map((order) => ({ ...order }));
  }

  async updateOrder(id: string, patch: OrderPatch): Promise<Order> {
    const current = this.orders.get(id);
    if (!current) {
      throw new MarketplaceError("ORDER_NOT_FOUND", "Order not found.");
    }
    const next = { ...current, ...patch };
    this.orders.set(id, next);
    return { ...next };
  }
}
