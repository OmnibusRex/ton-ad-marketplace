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
