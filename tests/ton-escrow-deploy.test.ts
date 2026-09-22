import { Address, beginCell, Cell } from "@ton/core";
import { describe, expect, it, vi } from "vitest";
import { buildDepositBody, buildReleaseBody } from "../src/ton/escrow-messages.js";
import { buildEscrowData, deriveEscrowAddress, formatTestnetAddress, planTestnetEscrow } from "../src/ton/escrow-deploy.js";
import { parsePrepareArgs } from "../src/ton/prepare-args.js";
import { TON_ESCROW_OP } from "../src/ton/opcodes.js";

const admin = Address.parse(`0:${"ab".repeat(32)}`);
const seller = Address.parse(`0:${"cd".repeat(32)}`);
const code = beginCell().storeUint(7, 8).endCell();

describe("unsigned testnet escrow preparation", () => {
  it("stores an empty deals dict and derives a stable testnet address", () => {
    const data = buildEscrowData(admin);
    const slice = data.beginParse();
    expect(slice.loadAddress().equals(admin)).toBe(true);
    expect(slice.loadBit()).toBe(false);
    expect(slice.remainingBits).toBe(0);

    const first = deriveEscrowAddress(code, admin);
    const second = deriveEscrowAddress(code, admin);
    expect(first.equals(second)).toBe(true);
    expect(formatTestnetAddress(first)).toMatch(/^[0kEU]Q/);
  });

  it("builds deposit and release bodies that match the FunC layout", () => {
    const deposit = buildDepositBody(1n, seller, 1_700_000_000n, 7n).beginParse();
    expect(deposit.loadUint(32)).toBe(TON_ESCROW_OP.deposit);
    expect(deposit.loadUintBig(64)).toBe(7n);
    expect(deposit.loadUintBig(256)).toBe(1n);
    expect(deposit.loadAddress().equals(seller)).toBe(true);
    expect(deposit.loadUintBig(64)).toBe(1_700_000_000n);

    const release = buildReleaseBody(99n).beginParse();
    expect(release.loadUint(32)).toBe(TON_ESCROW_OP.release);
    expect(release.loadUintBig(64)).toBe(0n);
    expect(release.loadUintBig(256)).toBe(99n);
  });

  it("plans artifacts without calling the network and refuses broadcast flags", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    const plan = await planTestnetEscrow({
      code,
      adminAddress: admin.toString({ testOnly: true, bounceable: true }),
      sellerAddress: seller.toString({ testOnly: true, bounceable: true }),
      orderId: "order-1",
      deadlineUnix: 1_800_000_000n,
      amountTon: "0.1",
    });
    expect(plan.contractAddress).toMatch(/^[0kEU]Q/);
    expect(plan.depositBoc).toBeTruthy();
    expect(plan.manualSteps).toContain("Nothing was signed, broadcast, or funded");
    expect(plan.manualSteps).toContain("Leave ESCROW_MODE unset");
    expect(Cell.fromBase64(plan.stateInitBoc).hash().length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    expect(() => parsePrepareArgs(["--broadcast"])).toThrow(/broadcast/);
    expect(() => parsePrepareArgs(["--mnemonic", "abandon abandon"])).toThrow(/mnemonic/);
    expect(() => parsePrepareArgs(["alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu"])).toThrow(
      /seed-like/,
    );
    expect(() => parsePrepareArgs(["--admin", admin.toString()], { MNEMONIC: "secret words here" })).toThrow(
      /signing secrets/,
    );
    const adminText = admin.toString({ testOnly: true, bounceable: true });
    const parsed = parsePrepareArgs(["--admin", adminText]);
    expect(parsed.admin).toBe(adminText);
  });
});
