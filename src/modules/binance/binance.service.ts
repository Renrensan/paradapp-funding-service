import { inject, injectable } from "tsyringe";
import { BINANCE_TOKENS } from "./tokens";
import { INDODAX_TOKENS } from "../indodax/tokens";
import { roundToBinanceStep } from "./binance.helper";
import { IBinanceService } from "./binance.types";
import { TRANSACTION_TOKENS } from "../transaction-management/tokens";
import { IIndodaxService } from "../indodax/indodax.types";
import { ITransactionManagementService } from "../transaction-management/transaction-management.type";
import { TokenType } from "@prisma/client";
import { XenditService } from "../xendit/xendit.service";
import { TOKEN_CONSTANTS, SHARING } from "../../common/fee.const";

@injectable()
export class BinanceService implements IBinanceService {
  constructor(
    @inject(BINANCE_TOKENS.BINANCE_CLIENT) private binanceClient: any,
    @inject(INDODAX_TOKENS.INDODAX_SERVICE)
    private indodaxService: IIndodaxService,
    @inject(INDODAX_TOKENS.INDODAX_SERVICE)
    private xenditService: XenditService,
    @inject(TRANSACTION_TOKENS.TRANSACTION_SERVICE)
    private transactionService: ITransactionManagementService
  ) {}

  public async getTokenToIdrPrice(token: TokenType): Promise<number> {
    try {
      const tokenusdt = await this.binanceClient.prices(`${token}USDT`);
      const tokenToUsd = parseFloat(tokenusdt[`${token}USDT`]);
      const usdToIdr = (await this.indodaxService.fetchTicker("usdt_idr")).buy;
      return tokenToUsd * usdToIdr;
    } catch (err: any) {
      throw {
        status: 500,
        message: err?.message || "Internal Server Error",
        raw: err,
      };
    }
  }

  public async buyTokenFromBinance(
    token: TokenType,
    idrAmount: number
  ): Promise<{ cexTxId: string; tokenAmount: number }> {
    const price = await this.getTokenToIdrPrice(token);
    const tokenAmount = roundToBinanceStep(idrAmount / price, token, true);

    try {
      const response = await this.binanceClient.marketBuy(
        `${token}USDT`,
        tokenAmount
      );
      return { tokenAmount, cexTxId: String(response.orderId) };
    } catch (err) {
      throw err;
    }
  }

  public async sellTokenFromBinance(
    token: TokenType,
    tokenAmount: number
  ): Promise<{ cexTxId: string; idrAmount: number }> {
    const cfg = TOKEN_CONSTANTS[token];

    const toleranceSlippage = Math.max(
      roundToBinanceStep(
        cfg.WITHDRAW.TOLERANCE_SLIPPAGE_PERCENT * tokenAmount,
        token
      ),
      cfg.WITHDRAW.TOLERANCE_SLIPPAGE_FIX
    );

    const platformFee = Math.max(
      roundToBinanceStep(SHARING.PLATFORM_FEE_PERCENT * tokenAmount, token),
      cfg.WITHDRAW.PLATFORM_FEE_FIX
    );

    const operationalToIndodaxFee = cfg.INTERNAL_FEES.OPERATIONAL_TO_INDODAX;

    const indodaxFee = roundToBinanceStep(
      (SHARING.INDODAX_FEE_PERCENT + cfg.WITHDRAW.TAX_PERCENT) *
        (tokenAmount -
          toleranceSlippage -
          platformFee -
          operationalToIndodaxFee),
      token
    );

    const payoutFee = cfg.WITHDRAW.PAYOUT_GATEWAY_FEE;

    const amountForBinance =
      tokenAmount -
      operationalToIndodaxFee -
      indodaxFee -
      platformFee -
      toleranceSlippage;

    const tokenAmountSell = roundToBinanceStep(amountForBinance, token, true);

    const price = await this.getTokenToIdrPrice(token);

    const idrAmount = Math.floor(tokenAmountSell * price) - payoutFee;

    try {
      const response = await this.binanceClient.marketSell(
        `${token}USDT`,
        tokenAmountSell
      );
      return { idrAmount, cexTxId: String(response.orderId) };
    } catch (err) {
      throw err;
    }
  }
}
