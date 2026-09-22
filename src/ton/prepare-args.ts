import { assertArgsHaveNoMnemonic, assertNoSigningSecrets } from "./no-secrets.js";

export type PrepareArgs = {
  help: boolean;
  admin?: string;
  seller?: string;
  orderId?: string;
  amountTon?: string;
  deadline?: bigint;
};

export const PREPARE_USAGE = `Usage: npm run prepare:escrow -- --admin <testnet-address>

Optional sample deposit (all three required):
  --seller <address> --order-id <id> --deadline <unix-seconds> --amount-ton <ton>

Reads ESCROW_ADMIN_ADDRESS when --admin is omitted.
Does not accept a mnemonic. Does not broadcast, deploy, or spend TON.`;

export function parsePrepareArgs(argv: string[], env: NodeJS.ProcessEnv = {}): PrepareArgs {
  assertNoSigningSecrets(env);
  assertArgsHaveNoMnemonic(argv);
  const parsed: PrepareArgs = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    const next = argv[i + 1];
    const take = (name: string): string => {
      if (!next || next.startsWith("--")) {
        throw new Error(`${name} requires a value. ${PREPARE_USAGE}`);
      }
      i += 1;
      return next;
    };
    if (arg === "--admin") {
      parsed.admin = take("--admin");
    } else if (arg === "--seller") {
      parsed.seller = take("--seller");
    } else if (arg === "--order-id") {
      parsed.orderId = take("--order-id");
    } else if (arg === "--amount-ton") {
      parsed.amountTon = take("--amount-ton");
    } else if (arg === "--deadline") {
      const raw = take("--deadline");
      if (!/^\d+$/.test(raw)) {
        throw new Error("--deadline must be a unix timestamp in seconds.");
      }
      parsed.deadline = BigInt(raw);
    } else {
      throw new Error(`Unknown argument. ${PREPARE_USAGE}`);
    }
  }
  if (!parsed.help && !parsed.admin) {
    const fromEnv = env.ESCROW_ADMIN_ADDRESS?.trim();
    if (fromEnv) {
      parsed.admin = fromEnv;
    }
  }
  if (!parsed.help && !parsed.admin) {
    throw new Error(`Missing --admin. ${PREPARE_USAGE}`);
  }
  return parsed;
}
