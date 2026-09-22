import type { Channel, Order, OrderStatus } from "./types.js";

export type OrderPatch = Partial<
  Pick<Order, "status" | "adText" | "paymentTxHash" | "lastError" | "publishDeadline" | "settledAt">
>;

export type ReadOptions = {
  forUpdate?: boolean;
};

export type UpdateOrderOptions = {
  expectedStatuses?: OrderStatus[];
};

export type ChannelUpdate = Pick<Channel, "title" | "telegramChatId" | "memberCount" | "priceTon">;

export interface MarketplaceStore {
  saveChannel(channel: Channel): Promise<Channel>;
  updateChannel(id: string, patch: ChannelUpdate): Promise<Channel>;
  listChannels(): Promise<Channel[]>;
  getChannel(id: string): Promise<Channel | null>;
  getChannelByHandle(handle: string): Promise<Channel | null>;
  saveOrder(order: Order): Promise<Order>;
  getOrder(id: string, options?: ReadOptions): Promise<Order | null>;
  getOrderByPaymentComment(comment: string, options?: ReadOptions): Promise<Order | null>;
  getOrderByPaymentTxHash(txHash: string, options?: ReadOptions): Promise<Order | null>;
  listOrdersByStatuses(statuses: OrderStatus[]): Promise<Order[]>;
  updateOrder(id: string, patch: OrderPatch, options?: UpdateOrderOptions): Promise<Order>;
}
