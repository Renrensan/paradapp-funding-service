import "reflect-metadata";
import { config } from "dotenv";
config();
import { container } from "tsyringe";
import { BTCService } from "../btc.service";
import { registerBTCModule } from "../btc.module";
import { BTC_TOKENS } from "../tokens";

beforeAll(() => {
  registerBTCModule();
});

describe("BitcoinService Integration Test", () => {
  let service: BTCService;
  let broadcastedTxId: string;

  beforeAll(() => {
    service = container.resolve<BTCService>(BTC_TOKENS.BTCService);
  });

  it("should fetch incoming transactions for dev wallet", async () => {
    const address = process.env.DEV_BTC_ADDRESS!;
    const txs = await service.getIncomingTransactions(address);
    expect(Array.isArray(txs)).toBe(true);
  });

  it("should not send bulk BTC if no new block or no deposits", async () => {
    const result = await service.sendBTCBulkToUsers([]);
    expect(typeof result).toBe("string");
  });

  it("should broadcast a real BTC transaction when deposits exist", async () => {
    const deposits = [
      {
        btcAddress: process.env.TEST_BTC_RECEIVER!,
        btcAmount: 0.000003,
        refBtcAddress: undefined,
        refBtcAmount: undefined,
      },
    ];

    try {
      const txid = await service.sendBTCBulkToUsers(deposits);
      broadcastedTxId = txid;
      expect(typeof txid).toBe("string");
    } catch (err) {
      console.error("Broadcast error:", err);
      throw err;
    }
  });

  it("should check confirmation status of a transaction", async () => {
    if (!broadcastedTxId) throw new Error("No txid from previous test");

    try {
      const confirmed = await service.isTransactionConfirmed(broadcastedTxId);
      expect(typeof confirmed).toBe("boolean");
    } catch (err) {
      console.error("Confirmation check error:", err);
      throw err;
    }
  });
});
