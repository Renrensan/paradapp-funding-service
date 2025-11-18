import "reflect-metadata";
import { config } from "dotenv";
config();
import { container } from "tsyringe";
import { registerIndodaxModule } from "../indodax.module";
import { INDODAX_TOKENS } from "../tokens";
import { IndodaxService } from "../indodax.service";

beforeAll(() => {
  registerIndodaxModule(process.env.INDODAX_API_KEY!, process.env.INDODAX_SECRET!);
});

describe("IndodaxService Integration Test", () => {
  let service: IndodaxService;

  beforeAll(() => {
    service = container.resolve<IndodaxService>(INDODAX_TOKENS.INDODAX_SERVICE);
  });

  it("should fetch ticker for BTC/IDR", async () => {
    const ticker = await service.fetchTicker("usdt_idr");
    console.log("Ticker response:", ticker);
    expect(ticker).toHaveProperty("buy");
  });

//   it("should call privateCall with getInfo method", async () => {
//     const response = await service.privateCall("getInfo");
//     console.log("PrivateCall getInfo response:", response);
//     expect(response).toHaveProperty("success", 1);
//     expect(response).toHaveProperty("return");
//   });
});
