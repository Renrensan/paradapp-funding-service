import { config } from "dotenv";
config();
import "reflect-metadata";
import { container } from "tsyringe";
import { BinanceService } from "../binance.service";
import { registerBinanceModule } from "../binance.module";
import { registerIndodaxModule } from "../../indodax/indodax.module";
import { IBinanceService } from "../binance.types";
import { TokenType } from "@prisma/client";

describe("BinanceService Integration Test", () => {
  let service: IBinanceService;

  beforeAll(() => {
    registerBinanceModule();
    registerIndodaxModule(process.env.INDODAX_API_KEY!, process.env.INDODAX_SECRET!);
    service = container.resolve<BinanceService>(BinanceService);
  });

it("should buy all supported tokens using IDR amount from testnet", async () => {
  const idrAmount = 100_000;

  for (const token of Object.values(TokenType)) {
    try {
      const result = await service.buyTokenFromBinance(token, idrAmount);
      console.log(`Buy ${token} result:`, result);

      expect(result).toHaveProperty("cexTxId");
      expect(typeof result.tokenAmount).toBe("number");
      expect(result.tokenAmount).toBeGreaterThan(0);
    } catch (err: any) {
      console.error(`Failed to buy ${token}:`, err);
      throw err;
    }
  }
});

  it("should sell BTC and HBAR on testnet", async () => {
    const sellAmounts = {
      [TokenType.BTC]: 0.01,  // bigger so fees don't zero it out
      [TokenType.HBAR]: 100      // enough above 1 to survive fee subtraction
    };

    for (const token of [TokenType.BTC, TokenType.HBAR]) {
      const tokenAmount = sellAmounts[token];

      try {
        const result = await service.sellTokenFromBinance(token, tokenAmount);
        console.log(`Sell ${token} result:`, result);

        expect(result).toHaveProperty("cexTxId");
        expect(typeof result.idrAmount).toBe("number");
        expect(result.idrAmount).toBeGreaterThan(0);
      } catch (err: any) {
        console.error(`Failed to sell ${token}:`, err);
        throw err;
      }
    }
  });



});
