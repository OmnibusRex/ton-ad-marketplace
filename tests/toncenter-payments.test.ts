import { describe, expect, it, vi } from "vitest";
import { findPaymentForComment } from "../src/adapters/toncenter-payments.js";

describe("toncenter payment watcher", () => {
  it("matches a comment and nanotons amount without calling the network", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      data: {
        result: [
          {
            transaction_id: { hash: "hash-1" },
            in_msg: {
              message: "AdOrder_id-2",
              value: "1500000000",
            },
          },
        ],
      },
    });

    const found = await findPaymentForComment(
      {
        walletAddress: "watched-test-wallet",
        apiUrl: "https://example.test/api/v2",
        fetchImpl: fetchImpl as never,
      },
      "AdOrder_id-2",
      "1.5",
    );

    expect(found).toEqual({
      comment: "AdOrder_id-2",
      amountTon: "1.5",
      txHash: "hash-1",
    });
    expect(fetchImpl).toHaveBeenCalled();
  });
});
