import { MarketplaceError } from "./errors.js";

export const NANOTON = 1_000_000_000n;

export function parseTon(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new MarketplaceError("INVALID_AMOUNT", `Invalid TON amount: ${value}`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > 9) {
    throw new MarketplaceError("INVALID_AMOUNT", "TON amount has more than 9 decimal places");
  }
  return BigInt(whole) * NANOTON + BigInt(fraction.padEnd(9, "0"));
}

export function formatTon(nanotons: bigint): string {
  const whole = nanotons / NANOTON;
  const fraction = (nanotons % NANOTON).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

export function assertPositivePrice(value: string): string {
  const nano = parseTon(value);
  if (nano <= 0n) {
    throw new MarketplaceError("INVALID_PRICE", "Price must be greater than 0 TON");
  }
  return formatTon(nano);
}
