import { Address, beginCell, Cell, contractAddress, storeStateInit } from "@ton/core";
import { hashOrderId } from "./hash-order.js";
import { assertPositivePrice } from "../domain/money.js";
import { buildDepositBody, cellToBase64 } from "./escrow-messages.js";

/** Init data: admin MsgAddress + empty deals dict (`store_dict` 0 bit). */
export function buildEscrowData(admin: Address): Cell {
  return beginCell().storeAddress(admin).storeDict(null).endCell();
}

export function buildEscrowStateInit(code: Cell, admin: Address): { code: Cell; data: Cell } {
  return { code, data: buildEscrowData(admin) };
}

export function deriveEscrowAddress(code: Cell, admin: Address, workchain = 0): Address {
  return contractAddress(workchain, buildEscrowStateInit(code, admin));
}

export function stateInitCell(code: Cell, admin: Address): Cell {
  return beginCell().store(storeStateInit(buildEscrowStateInit(code, admin))).endCell();
}

export function formatTestnetAddress(address: Address): string {
  return address.toString({ bounceable: true, testOnly: true, urlSafe: true });
}

export type TestnetEscrowPlan = {
  dataBoc: string;
  stateInitBoc: string;
  contractAddress: string;
  depositBoc?: string;
  manualSteps: string;
};

/**
 * Build unsigned testnet artifacts. Does not open a network connection.
 */
export async function planTestnetEscrow(input: {
  code: Cell;
  adminAddress: string;
  sellerAddress?: string;
  orderId?: string;
  deadlineUnix?: bigint;
  amountTon?: string;
}): Promise<TestnetEscrowPlan> {
  const admin = Address.parse(input.adminAddress);
  const data = buildEscrowData(admin);
  const stateInit = stateInitCell(input.code, admin);
  const address = deriveEscrowAddress(input.code, admin);
  let depositBoc: string | undefined;
  if (input.sellerAddress || input.orderId || input.deadlineUnix !== undefined) {
    if (!input.sellerAddress || !input.orderId || input.deadlineUnix === undefined) {
      throw new Error("A sample deposit needs --seller, --order-id, and --deadline together.");
    }
    if (input.amountTon) {
      assertPositivePrice(input.amountTon);
    }
    const seller = Address.parse(input.sellerAddress);
    const body = buildDepositBody(await hashOrderId(input.orderId), seller, input.deadlineUnix);
    depositBoc = cellToBase64(body);
  }

  const contractAddressText = formatTestnetAddress(address);
  return {
    dataBoc: cellToBase64(data),
    stateInitBoc: cellToBase64(stateInit),
    contractAddress: contractAddressText,
    depositBoc,
    manualSteps: manualSteps({
      contractAddress: contractAddressText,
      admin: formatTestnetAddress(admin),
      amountTon: input.amountTon,
      hasDeposit: Boolean(depositBoc),
    }),
  };
}

function manualSteps(input: {
  contractAddress: string;
  admin: string;
  amountTon?: string;
  hasDeposit: boolean;
}): string {
  const amountLine = input.amountTon
    ? `Attach ${input.amountTon} testnet TON as the deposit value (the amount is not inside the body).`
    : "Attach the order price in testnet TON as the deposit value.";
  return [
    "Unsigned testnet escrow artifacts. Nothing was signed, broadcast, or funded.",
    `Derived testnet address: ${input.contractAddress}`,
    `Admin stored in init data: ${input.admin}`,
    "",
    "Everton still has to do these steps by hand:",
    "1. Use a testnet wallet you control. Do not put its mnemonic in git, Railway, or this script.",
    "2. Review contracts/build/*.boc. code, data, and state init are unsigned.",
    "3. Deploy the state init with your own testnet tool. Confirm the explorer host is testnet.",
    "4. Send extra testnet TON to the contract for forwarding fees. This repo will not send it.",
    input.hasDeposit
      ? `5. Optional sample deposit body was written. ${amountLine} Send it only from the advertiser wallet, after you understand contracts/escrow.fc.`
      : "5. No sample deposit was requested. Build one later with --seller, --order-id, and --deadline.",
    "6. Only after a testnet deploy, set ESCROW_CONTRACT_ADDRESS and ESCROW_MODE=ton_testnet plus ESCROW_TESTNET_ACK=I_UNDERSTAND_NO_BROADCAST.",
    "7. Even then the bot does not sign or broadcast. Release and refund still fail closed until you send those messages yourself.",
    "8. Leave ESCROW_MODE unset (or postgres) on the live Railway service. That path stays PostgresEscrow.",
    "9. Channel walkthrough (add the bot as admin, /register_channel, pay, publish) is still manual. See docs/GO_LIVE.md.",
    "",
    "Do not deploy this contract to mainnet.",
  ].join("\n");
}
