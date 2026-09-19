import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunc } from "@ton-community/func-js";

const contractsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "contracts");

export async function compileEscrowContract(): Promise<{ codeBoc: string; fiftCode: string }> {
  const result = await compileFunc({
    targets: ["escrow.fc"],
    sources: (path: string) => readFileSync(join(contractsDir, path), "utf8"),
  });

  if (result.status === "error") {
    throw new Error(`FunC compile failed:\n${result.message}`);
  }

  return { codeBoc: result.codeBoc, fiftCode: result.fiftCode };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const compiled = await compileEscrowContract();
  const outDir = join(contractsDir, "build");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "escrow.fif"), compiled.fiftCode);
  console.log("Compiled contracts/escrow.fc (testnet skeleton, unaudited). No transaction was sent.");
}
