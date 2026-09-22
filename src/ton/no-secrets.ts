/** Env names this process refuses to boot with. Values are never printed. */
export const SIGNING_SECRET_ENV = [
  "MNEMONIC",
  "WALLET_MNEMONIC",
  "TON_MNEMONIC",
  "ESCROW_MNEMONIC",
  "SEED_PHRASE",
  "WALLET_SEED",
  "TON_PRIVATE_KEY",
  "WALLET_PRIVATE_KEY",
  "ESCROW_PRIVATE_KEY",
] as const;

const BANNED_FLAGS = new Set([
  "--mnemonic",
  "--seed",
  "--seed-phrase",
  "--private-key",
  "--secret-key",
  "--broadcast",
  "--send",
  "--deploy",
  "--mainnet",
]);

export function assertNoSigningSecrets(env: NodeJS.ProcessEnv): void {
  const present = SIGNING_SECRET_ENV.filter((name) => Boolean(env[name]?.trim()));
  if (present.length > 0) {
    throw new Error(
      `Refusing to start with signing secrets in the environment (${present.join(", ")}). ` +
        "Remove them. This process never signs or broadcasts transactions.",
    );
  }
}

function looksLikeMnemonic(arg: string): boolean {
  const words = arg.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    return false;
  }
  return words.every((word) => /^[a-z]+$/.test(word));
}

/** Prepare-script guard. Does not print the offending argument value. */
export function assertArgsHaveNoMnemonic(argv: string[]): void {
  for (const arg of argv) {
    const flag = arg.toLowerCase().split("=")[0] ?? "";
    if (BANNED_FLAGS.has(flag) || looksLikeMnemonic(arg)) {
      throw new Error(
        `Refusing ${flag.startsWith("--") ? flag : "a seed-like argument"}: this script never signs, broadcasts, deploys, or reads a mnemonic.`,
      );
    }
  }
}
