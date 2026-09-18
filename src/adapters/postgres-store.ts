import pg from "pg";
import type { OrderPatch, MarketplaceStore } from "../domain/store.js";
import type { Channel, Order, OrderStatus } from "../domain/types.js";
import { MarketplaceError } from "../domain/errors.js";

const { Client } = pg;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  title TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  member_count INTEGER NOT NULL,
  price_ton TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  telegram_chat_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  advertiser_id TEXT NOT NULL,
  amount_ton TEXT NOT NULL,
  payment_comment TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  ad_text TEXT,
  payment_tx_hash TEXT UNIQUE,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  publish_deadline TIMESTAMPTZ,
  settled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS escrow_receipts (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  status TEXT NOT NULL,
  amount_ton TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  advertiser_id TEXT NOT NULL,
  payment_ref TEXT NOT NULL,
  settled_at TIMESTAMPTZ
);
`;

function mapChannel(row: Record<string, unknown>): Channel {
  return {
    id: String(row.id),
    handle: String(row.handle),
    title: String(row.title),
    telegramChatId: String(row.telegram_chat_id),
    ownerId: String(row.owner_id),
    memberCount: Number(row.member_count),
    priceTon: String(row.price_ton),
    createdAt: new Date(String(row.created_at)),
  };
}

function mapOrder(row: Record<string, unknown>): Order {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    telegramChatId: String(row.telegram_chat_id),
    sellerId: String(row.seller_id),
    advertiserId: String(row.advertiser_id),
    amountTon: String(row.amount_ton),
    paymentComment: String(row.payment_comment),
    status: String(row.status) as OrderStatus,
    adText: row.ad_text == null ? null : String(row.ad_text),
    paymentTxHash: row.payment_tx_hash == null ? null : String(row.payment_tx_hash),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: new Date(String(row.created_at)),
    publishDeadline: row.publish_deadline ? new Date(String(row.publish_deadline)) : null,
    settledAt: row.settled_at ? new Date(String(row.settled_at)) : null,
  };
}

export class PostgresStore implements MarketplaceStore {
  constructor(private readonly client: InstanceType<typeof Client>) {}

  async migrate(): Promise<void> {
    await this.client.query(SCHEMA_SQL);
  }

  async upsertUser(id: string, username: string | undefined): Promise<void> {
    await this.client.query(
      `INSERT INTO users (id, username) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username`,
      [id, username ?? null],
    );
  }

  async saveChannel(channel: Channel): Promise<Channel> {
    await this.client.query(
      `INSERT INTO channels (id, handle, title, telegram_chat_id, owner_id, member_count, price_ton, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        channel.id,
        channel.handle,
        channel.title,
        channel.telegramChatId,
        channel.ownerId,
        channel.memberCount,
        channel.priceTon,
        channel.createdAt,
      ],
    );
    return channel;
  }

  async listChannels(): Promise<Channel[]> {
    const res = await this.client.query(`SELECT * FROM channels ORDER BY member_count DESC`);
    return res.rows.map(mapChannel);
  }

  async getChannel(id: string): Promise<Channel | null> {
    const res = await this.client.query(`SELECT * FROM channels WHERE id = $1`, [id]);
    return res.rows[0] ? mapChannel(res.rows[0]) : null;
  }

  async saveOrder(order: Order): Promise<Order> {
    await this.client.query(
      `INSERT INTO orders (
         id, channel_id, telegram_chat_id, seller_id, advertiser_id, amount_ton,
         payment_comment, status, ad_text, payment_tx_hash, last_error,
         created_at, publish_deadline, settled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        order.id,
        order.channelId,
        order.telegramChatId,
        order.sellerId,
        order.advertiserId,
        order.amountTon,
        order.paymentComment,
        order.status,
        order.adText,
        order.paymentTxHash,
        order.lastError,
        order.createdAt,
        order.publishDeadline,
        order.settledAt,
      ],
    );
    return order;
  }

  async getOrder(id: string): Promise<Order | null> {
    const res = await this.client.query(`SELECT * FROM orders WHERE id = $1`, [id]);
    return res.rows[0] ? mapOrder(res.rows[0]) : null;
  }

  async getOrderByPaymentComment(comment: string): Promise<Order | null> {
    const res = await this.client.query(`SELECT * FROM orders WHERE payment_comment = $1`, [comment]);
    return res.rows[0] ? mapOrder(res.rows[0]) : null;
  }

  async getOrderByPaymentTxHash(txHash: string): Promise<Order | null> {
    const res = await this.client.query(`SELECT * FROM orders WHERE payment_tx_hash = $1`, [txHash]);
    return res.rows[0] ? mapOrder(res.rows[0]) : null;
  }

  async listOrdersByStatuses(statuses: OrderStatus[]): Promise<Order[]> {
    const res = await this.client.query(`SELECT * FROM orders WHERE status = ANY($1)`, [statuses]);
    return res.rows.map(mapOrder);
  }

  async updateOrder(id: string, patch: OrderPatch): Promise<Order> {
    const current = await this.getOrder(id);
    if (!current) {
      throw new MarketplaceError("ORDER_NOT_FOUND", "Order not found.");
    }
    const next: Order = { ...current, ...patch };
    await this.client.query(
      `UPDATE orders SET
         status = $2,
         ad_text = $3,
         payment_tx_hash = $4,
         last_error = $5,
         publish_deadline = $6,
         settled_at = $7
       WHERE id = $1`,
      [
        id,
        next.status,
        next.adText,
        next.paymentTxHash,
        next.lastError,
        next.publishDeadline,
        next.settledAt,
      ],
    );
    return next;
  }
}

export { SCHEMA_SQL };
