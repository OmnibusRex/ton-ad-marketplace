const MAINNET_HOSTS = new Set(["toncenter.com", "tonapi.io", "ton.org"]);

export function endpointHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TONCENTER_API_URL is not a valid URL");
  }
  return parsed.hostname.toLowerCase();
}

/** Reject obvious mainnet API hosts. Testnet and local fixtures pass. */
export function assertTestnetEndpoint(url: string): void {
  const host = endpointHost(url);
  if (host.includes("mainnet") || MAINNET_HOSTS.has(host)) {
    throw new Error(
      "Mainnet TON endpoints are not allowed. Use a testnet URL such as https://testnet.toncenter.com/api/v2.",
    );
  }
}
