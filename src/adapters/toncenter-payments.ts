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

function extractComment(tx: Record<string, unknown>): string | null {
  const inMsg = tx.in_msg as Record<string, unknown> | undefined;
  if (!inMsg) {
    return null;
  }
  if (typeof inMsg.message === "string" && inMsg.message.length > 0) {
    return inMsg.message;
  }
  const msgData = inMsg.msg_data as Record<string, unknown> | undefined;
  if (msgData && typeof msgData.text === "string") {
    return msgData.text;
  }
  return null;
}

/**
 * Payment *detection* against a watched address. Matching a comment is not
 * custody: funds at the watched wallet are not programmatically bound until a
 * contract implements EscrowPort.
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
    const comment = extractComment(tx);
    const inMsg = tx.in_msg as Record<string, unknown> | undefined;
    const rawValue = inMsg?.value;
    const hash =
      (tx.transaction_id as Record<string, unknown> | undefined)?.hash ??
      tx.transaction_id;
    if (comment !== paymentComment || rawValue == null || hash == null) {
      continue;
    }
    const paid = BigInt(String(rawValue));
    if (paid >= minimum) {
      return {
        comment,
        amountTon: nanotonsToTonString(String(rawValue)),
        txHash: String(hash),
      };
    }
  }
  return null;
}
