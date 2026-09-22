import { Address } from "@ton/core";
import axios from "axios";
import { parseTon } from "../domain/money.js";

export type ObservedPayment = {
  comment: string;
  amountTon: string;
  txHash: string;
};

export type ToncenterWatcherOptions = {
  walletAddress: string;
  apiUrl: string;
  apiKey?: string;
  fetchImpl?: typeof axios.get;
};

function nanotonsToTonString(value: string | number): string {
  const nano = BigInt(value);
  const whole = nano / 1_000_000_000n;
  const fraction = (nano % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

/** Friendly bounceable and non-bounceable forms of the same account match. */
export function sameAddress(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) {
    return false;
  }
  try {
    return Address.parse(a).equals(Address.parse(b));
  } catch {
    return a === b;
  }
}

export function decodeToncenterText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("AdOrder_")) {
    return trimmed;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    return trimmed;
  }
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (decoded.startsWith("AdOrder_") && /^[\t\n\r\x20-\x7e]+$/.test(decoded)) {
    return decoded.trim();
  }
  return trimmed;
}

function extractComment(inMsg: Record<string, unknown>): string | null {
  if (typeof inMsg.message === "string" && inMsg.message.trim().length > 0) {
    return inMsg.message.trim();
  }
  const msgData = inMsg.msg_data as Record<string, unknown> | undefined;
  if (!msgData || typeof msgData.text !== "string" || msgData.text.length === 0) {
    return null;
  }
  return decodeToncenterText(msgData.text);
}

function extractTxHash(tx: Record<string, unknown>): string | null {
  const id = tx.transaction_id;
  if (typeof id === "string") {
    const hash = id.trim();
    return hash.length > 0 && hash !== "[object Object]" ? hash : null;
  }
  if (id && typeof id === "object" && typeof (id as { hash?: unknown }).hash === "string") {
    const hash = (id as { hash: string }).hash.trim();
    return hash.length > 0 ? hash : null;
  }
  return null;
}

function isBounced(tx: Record<string, unknown>, inMsg: Record<string, unknown>): boolean {
  if (inMsg.bounced === true || tx.bounced === true) {
    return true;
  }
  const description = tx.description;
  return Boolean(description && typeof description === "object" && (description as { bounced?: boolean }).bounced);
}

function inboundToWallet(inMsg: Record<string, unknown>, walletAddress: string): boolean {
  const source = inMsg.source;
  if (typeof source !== "string" || source.trim().length === 0) {
    return false;
  }
  const destination = inMsg.destination;
  if (typeof destination !== "string" || destination.trim().length === 0) {
    return false;
  }
  return sameAddress(destination, walletAddress);
}

/**
 * Payment *detection* against a watched address. Matching a comment is not
 * custody: funds at the watched wallet are not programmatically bound until a
 * contract implements EscrowPort.
 *
 * Only inbound messages to `walletAddress` with a sender, an exact comment,
 * and a string transaction hash are eligible. Bounced and outgoing messages
 * are ignored.
 */
export async function findPaymentForComment(
  options: ToncenterWatcherOptions,
  paymentComment: string,
  minimumAmountTon: string,
): Promise<ObservedPayment | null> {
  const url = `${options.apiUrl.replace(/\/$/, "")}/getTransactions`;
  const fetchImpl = options.fetchImpl ?? axios.get;
  const response = await fetchImpl(url, {
    params: {
      address: options.walletAddress,
      limit: 20,
      api_key: options.apiKey,
    },
  });
  const txs = (response.data?.result ?? []) as Record<string, unknown>[];
  const minimum = parseTon(minimumAmountTon);

  for (const tx of txs) {
    const inMsg = tx.in_msg as Record<string, unknown> | undefined;
    if (!inMsg || isBounced(tx, inMsg) || !inboundToWallet(inMsg, options.walletAddress)) {
      continue;
    }
    const comment = extractComment(inMsg);
    const hash = extractTxHash(tx);
    const rawValue = inMsg.value;
    if (comment !== paymentComment || rawValue == null || !hash) {
      continue;
    }
    const paid = BigInt(String(rawValue));
    if (paid >= minimum) {
      return {
        comment,
        amountTon: nanotonsToTonString(String(rawValue)),
        txHash: hash,
      };
    }
  }
  return null;
}
