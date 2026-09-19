import { describe, expect, it } from "vitest";
import { compileEscrowContract } from "../scripts/compile-escrow.js";

describe("FunC escrow skeleton", () => {
  it("compiles the testnet contract without sending a transaction", async () => {
    const compiled = await compileEscrowContract();
    expect(compiled.codeBoc.length).toBeGreaterThan(0);
    expect(compiled.fiftCode).toContain("recv_internal");
  }, 60_000);
});
