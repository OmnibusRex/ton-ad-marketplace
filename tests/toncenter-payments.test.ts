import { Address } from "@ton/core";
import { describe, expect, it, vi } from "vitest";
import { decodeToncenterText, findPaymentForComment, sameAddress } from "../src/adapters/toncenter-payments.js";

const wallet = Address.parse(`0:${"ab".repeat(32)}`);
const walletText = wallet.toString({ bounceable: false, testOnly: true });
const destinationText = wallet.toString({ bounceable: true, testOnly: true });

function tx(overrides: Record<string, unknown> = {}) {
  return {
    transaction_id: { hash: "hash-1" },
    in_msg: {
      source: "0:1111111111111111111111111111111111111111111111111111111111111111",
      destination: destinationText,
      message: "AdOrder_id-2",
      value: "1500000000",
    },
    ...overrides,
  };
}

function watcher(result: Record<string, unknown>[]) {
  const fetchImpl = vi.fn().mockResolvedValue({ data: { result } });
  return {
    fetchImpl,
    run: (comment = "AdOrder_id-2", minimum = "1.5") =>
      findPaymentForComment(
        {
          walletAddress: walletText,
          apiUrl: "https://example.test/api/v2",
          fetchImpl: fetchImpl as never,
        },
        comment,
        minimum,
      ),
  };
}

describe("toncenter payment watcher", () => {
  it("matches an inbound comment and nanotons amount without calling the network", async () => {
    const { fetchImpl, run } = watcher([tx()]);
    const found = await run();
    expect(found).toEqual({
      comment: "AdOrder_id-2",
      amountTon: "1.5",
      txHash: "hash-1",
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(sameAddress(walletText, destinationText)).toBe(true);
  });

  it("accepts overpayment and a base64 comment when message is empty", async () => {
    const comment = Buffer.from("AdOrder_id-2", "utf8").toString("base64");
    const found = await watcher([
      tx({
        in_msg: {
          source: "sender",
          destination: walletText,
          message: "",
          msg_data: { text: comment },
          value: "2000000000",
        },
      }),
    ]).run();
    expect(found?.amountTon).toBe("2");
    expect(found?.txHash).toBe("hash-1");
    expect(decodeToncenterText(comment)).toBe("AdOrder_id-2");
  });

  it("ignores outgoing, bounced, empty-source, short, and object-hash transactions", async () => {
    const cases = [
      tx({
        in_msg: {
          source: "sender",
          destination: "0:2222222222222222222222222222222222222222222222222222222222222222",
          message: "AdOrder_id-2",
          value: "1500000000",
        },
      }),
      tx({ bounced: true }),
      tx({
        in_msg: {
          source: "",
          destination: walletText,
          message: "AdOrder_id-2",
          value: "1500000000",
        },
      }),
      tx({
        in_msg: {
          source: "sender",
          destination: walletText,
          message: "AdOrder_id-2-extra",
          value: "1500000000",
        },
      }),
      tx({ transaction_id: { lt: "1" } }),
      tx({
        in_msg: {
          source: "sender",
          destination: walletText,
          message: "AdOrder_id-2",
          value: "1000000000",
        },
      }),
    ];
    for (const candidate of cases) {
      expect(await watcher([candidate]).run()).toBeNull();
    }
  });
});
