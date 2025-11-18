import Binance from "node-binance-api";
import { container } from "tsyringe";
import { BINANCE_TOKENS } from "./tokens";
import { BinanceService } from "./binance.service";
import { INDODAX_TOKENS } from "../indodax/tokens";
import { IndodaxService } from "../indodax/indodax.service";
import { TRANSACTION_TOKENS } from "../transaction-management/tokens";
import { TransactionService } from "../transaction-management/transaction-management.service";
import { XENDIT_TOKENS } from "../xendit/tokens";
import { XenditService } from "../xendit/xendit.service";

const binanceClient = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  useServerTime: true,
  test: true,
  urls: {
    base: process.env.BINANCE_API_URL,
  },
});

export function registerBinanceModule() {
  // Register Binance client & service
  container.registerInstance(BINANCE_TOKENS.BINANCE_CLIENT, binanceClient);
  container.registerSingleton(BINANCE_TOKENS.BINANCE_SERVICE, BinanceService);

  // Register Indodax service
  container.registerSingleton(INDODAX_TOKENS.INDODAX_SERVICE, IndodaxService);

  // Register Xendit service
  container.registerSingleton(XENDIT_TOKENS.XenditService, XenditService);

  // Register Transaction Service
  container.registerInstance(TRANSACTION_TOKENS.TRANSACTION_SERVICE, TransactionService)
}
