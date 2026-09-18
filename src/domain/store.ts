import type { Channel, Order, OrderStatus } from "./types.js";

export type OrderPatch = Partial<
  Pick<
    Order,
    "status" | "adText" | "paymentTxHash" | "lastError" | "publishDeadline" | "settledAt"
  >
>;

export interface MarketplaceStore {
  saveChannel(channel: Channel): Promise<Channel>;
  listChannels(): Promise<Channel[]>;
  getChannel(id: string): Promise<Channel | null>;
  saveOrder(order: Order): Promise<Order>;
  getOrder(id: string): Promise<Order | null>;
  getOrderByPaymentComment(comment: string): Promise<Order | null>;
  getOrderByPaymentTxHash(txHash: string): Promise<Order | null>;
  listOrdersByStatuses(statuses: OrderStatus[]): Promise<Order[]>;
  updateOrder(id: string, patch: OrderPatch): Promise<Order>;
}
