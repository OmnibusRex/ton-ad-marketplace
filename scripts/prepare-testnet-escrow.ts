import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cell } from "@ton/core";
import { compileEscrowContract } from "./compile-escrow.js";
import { planTestnetEscrow } from "../src/ton/escrow-deploy.js";
import { parsePrepareArgs, PREPARE_USAGE } from "../src/ton/prepare-args.js";

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

export async function writeTestnetEscrowArtifacts(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const args = parsePrepareArgs(argv, env);
  if (args.help) {
    console.log(PREPARE_USAGE);
    return;
  }
  const compiled = await compileEscrowContract();
  const plan = await planTestnetEscrow({
    code: Cell.fromBase64(compiled.codeBoc),
    adminAddress: args.admin!,
    sellerAddress: args.seller,
    orderId: args.orderId,
    deadlineUnix: args.deadline,
    amountTon: args.amountTon,
  });
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "contracts", "build");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "escrow-code.boc"), Buffer.from(compiled.codeBoc, "base64"));
  await writeFile(join(outDir, "escrow-data.boc"), Buffer.from(plan.dataBoc, "base64"));
  await writeFile(join(outDir, "escrow-state-init.boc"), Buffer.from(plan.stateInitBoc, "base64"));
  if (plan.depositBoc) {
    await writeFile(join(outDir, "escrow-deposit.boc"), Buffer.from(plan.depositBoc, "base64"));
  }
  await writeFile(join(outDir, "MANUAL_STEPS.txt"), `${plan.manualSteps}\n`);
  console.log(plan.manualSteps);
  console.log("Wrote unsigned BOCs under contracts/build. No transaction was signed or broadcast.");
}

if (invokedDirectly) {
  writeTestnetEscrowArtifacts(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "prepare failed";
    console.error(message);
    process.exitCode = 1;
  });
}
