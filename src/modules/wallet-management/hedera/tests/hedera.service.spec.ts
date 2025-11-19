import "reflect-metadata";
import { config } from "dotenv";
config();
import { container } from "tsyringe";
import { HederaService } from "../hedera.service";

describe("HederaService Integration Test", () => {
  let service: HederaService;
  // let broadcastedTxId: string;

  beforeAll(() => {
    service = container.resolve(HederaService);
  });

  afterAll(async () => {
    service["client"].close();
    container.clearInstances();
  });

  it("should fetch incoming transactions for operator account", async () => {
    try {
      const accountId = process.env.OPERATOR_ID!;
      const txs = await service.getIncomingTransactions(accountId);

      console.log("Incoming transactions:", txs);

      expect(Array.isArray(txs)).toBe(true);
    } catch (err) {
      console.error("Error in fetch incoming transactions:", err);
      throw err;
    }
  });

  it("should detect new consensus or no new consensus", async () => {
    try {
      const [hasNew, timestamp] = await service.monitorNewConsensus();

      console.log("Monitor consensus:", { hasNew, timestamp });

      expect(typeof hasNew).toBe("boolean");
      expect(typeof timestamp === "string" || timestamp === null).toBe(true);
    } catch (err) {
      console.error("Error in detect consensus:", err);
      throw err;
    }
  });

  it("should not send bulk HBAR if empty deposits", async () => {
    try {
      const result = await service.sendHBulkToUsers([]);

      console.log("Bulk send with empty deposits:", result);

      expect(typeof result).toBe("string");
    } catch (err) {
      console.error("Error in empty bulk send:", err);
      throw err;
    }
  });

  it("should send HBAR when deposits exist", async () => {
    try {
      const deposits = [
        {
          accountId: process.env.TEST_HBAR_RECEIVER!,
          hbarAmount: 1,
        },
        {
          accountId: process.env.TEST_HBAR_RECEIVER!,
          hbarAmount: 1,
        },
        {
          accountId: process.env.TEST_HBAR_RECEIVER!,
          hbarAmount: 1,
        },
      ];

      const txid = await service.sendHBulkToUsers(deposits);
      // broadcastedTxId = txid;

      console.log("HBAR bulk send txid:", txid);

      expect(typeof txid).toBe("string");
    } catch (err) {
      console.error("Error sending HBAR:", err);
      throw err;
    }
  });

  it("should check confirmation status of a transaction", async () => {
    try {
      const confirmed = await service.isTransactionConfirmed(
        "0.0.7066149@1763551040.333958966"
      );

      console.log("Confirmation status:", confirmed);

      expect(typeof confirmed).toBe("boolean");
    } catch (err) {
      console.error("Error in transaction confirmation:", err);
      throw err;
    }
  });
});
