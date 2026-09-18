export type Channel = {
  id: string;
  handle: string;
  title: string;
  telegramChatId: string;
  ownerId: string;
  memberCount: number;
  priceTon: string;
  createdAt: Date;
};

export type OrderStatus =
  | "awaiting_payment"
  | "escrow_locked"
  | "publish_failed"
  | "released"
  | "refunded"
  | "expired";

export type Order = {
  id: string;
  channelId: string;
  telegramChatId: string;
  sellerId: string;
  advertiserId: string;
  amountTon: string;
  paymentComment: string;
  status: OrderStatus;
  adText: string | null;
  paymentTxHash: string | null;
  lastError: string | null;
  createdAt: Date;
  publishDeadline: Date | null;
  settledAt: Date | null;
};

export type EscrowStatus = "locked" | "released" | "refunded";

export type EscrowReceipt = {
  orderId: string;
  status: EscrowStatus;
  amountTon: string;
  sellerId: string;
  advertiserId: string;
  paymentRef: string;
  settledAt: Date | null;
};

export type AdPublisherResult =
  | { ok: true }
  | { ok: false; error: string };

export type AdPublisher = {
  publish(telegramChatId: string, text: string): Promise<AdPublisherResult>;
};

export type RegisterChannelInput = {
  handle: string;
  title: string;
  ownerId: string;
  telegramChatId: string;
  memberCount: number;
  priceTon: string;
  botIsAdmin: boolean;
};

export type CreateOrderInput = {
  channelId: string;
  advertiserId: string;
};

export type MatchPaymentInput = {
  paymentComment: string;
  amountTon: string;
  txHash: string;
};

export type SubmitAdInput = {
  orderId: string;
  advertiserId: string;
  text: string;
};
