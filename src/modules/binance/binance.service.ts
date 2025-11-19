import { inject, injectable } from "tsyringe";
import { BINANCE_TOKENS } from "./tokens";
import { INDODAX_TOKENS } from "../indodax/tokens";
import { roundToBinanceStep } from "./binance.helper";
import { IBinanceService } from "./binance.types";
import { TRANSACTION_TOKENS } from "../transaction-management/tokens";
import { IIndodaxService } from "../indodax/indodax.types";
import { ITransactionManagementService } from "../transaction-management/transaction-management.type";
import { TokenType, TransactionType } from "@prisma/client";
import { REFERRAL, SHARING, TOKEN_CONSTANTS } from "./binance.constant";
import { XenditService } from "../xendit/xendit.service";
import { LIFETIME_REFERRERS } from "../../common/common.const";

@injectable()
export class BinanceService implements IBinanceService {
  constructor(
    @inject(BINANCE_TOKENS.BINANCE_CLIENT) private binanceClient: any,
    @inject(INDODAX_TOKENS.INDODAX_SERVICE) private indodaxService: IIndodaxService,
    @inject(INDODAX_TOKENS.INDODAX_SERVICE) private xenditService: XenditService,
    @inject(TRANSACTION_TOKENS.TRANSACTION_SERVICE) private transactionService: ITransactionManagementService
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
    const tokenAmount = roundToBinanceStep(idrAmount / price, token);

    try {
      const response = await this.binanceClient.marketBuy(`${token}USDT`, tokenAmount);
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
    console.log("tolerance:", toleranceSlippage)

    const platformFee = Math.max(
    roundToBinanceStep(
        SHARING.PLATFORM_FEE_PERCENT * tokenAmount,
        token
    ),
    cfg.WITHDRAW.PLATFORM_FEE_FIX
    );

    console.log("platform fee:", platformFee)

    const operationalToIndodaxFee = cfg.INTERNAL_FEES.OPERATIONAL_TO_INDODAX;

    console.log()

    const indodaxFee = roundToBinanceStep(
    (SHARING.INDODAX_FEE_PERCENT + cfg.WITHDRAW.TAX_PERCENT) *
        (tokenAmount - toleranceSlippage - platformFee - operationalToIndodaxFee),
    token
    );

    console.log("indodax fee:", indodaxFee)


    const payoutFee = cfg.WITHDRAW.PAYOUT_GATEWAY_FEE;

    const amountForBinance =
      tokenAmount -
      operationalToIndodaxFee -
      indodaxFee -
      platformFee -
      toleranceSlippage;

    console.log("amount from binance:", amountForBinance)

    const tokenAmountSell = roundToBinanceStep(
        amountForBinance,
        token
    );

    console.log("token amount to sell", tokenAmountSell)

    const price = await this.getTokenToIdrPrice(token);

    const idrAmount =
      Math.floor(tokenAmountSell * price) - payoutFee;

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

    async solveTransaction(id: string) {
    const tx = await this.transactionService.getSingleTransactionByID(id);
    if (!tx) throw new Error(`Transaction with ID ${id} not found`);

    const token = tx.tokenType;
    const C = TOKEN_CONSTANTS[token];
    const S = SHARING;
    const R = REFERRAL;

    if (tx.type === 'DEPOSIT') {
        if (!tx.cexTxId || !tx.tokenAmount) {
        const idrAmount = tx.idrAmount!;
        const method = (tx.paymentDetails as any)?.method;

        const paymentGatewayFee =
            method === "QRIS"
            ? Math.ceil(idrAmount * C.DEPOSIT.PAYMENT_GATEWAY_FEE_PERCENT)
            : C.DEPOSIT.PAYMENT_GATEWAY_FEE_FIX;

        const toleranceSlippage = Math.max(
            Math.ceil(idrAmount * C.DEPOSIT.TOLERANCE_SLIPPAGE_PERCENT),
            C.DEPOSIT.TOLERANCE_SLIPPAGE_FIX
        );

        const tax = Math.ceil(
            C.DEPOSIT.TAX_PERCENT * (idrAmount - paymentGatewayFee)
        );

        const indodaxFee = Math.max(
            Math.ceil(idrAmount * S.INDODAX_FEE_PERCENT),
            S.INDODAX_FEE_FIX
        );

        const binanceFee = Math.max(
            Math.ceil(idrAmount * S.BINANCE_FEE_PERCENT),
            S.BINANCE_FEE_FIX
        );

        const platformFee = Math.max(
            Math.ceil(idrAmount * S.PLATFORM_FEE_PERCENT),
            C.DEPOSIT.PLATFORM_FEE_FIX
        );

        const idrTotal =
            idrAmount - paymentGatewayFee - indodaxFee - binanceFee - tax;

        const idrUserBeforeOnChainFee = idrTotal - platformFee - toleranceSlippage;

        const idrRef = Math.max(R.REWARD_MIN, Math.floor(idrAmount * R.REWARD_PERCENT));

        const { cexTxId, tokenAmount } = await this.buyTokenFromBinance(
            token,
            idrTotal
        );

        const tokenA = tokenAmount;
        let tokenUserBefore = (idrUserBeforeOnChainFee / idrTotal) * tokenA;

        if (C.INTERNAL_FEES.BINANCE_TO_LEGACY_MAX !== undefined) {
        const f1 = Math.max(
            roundToBinanceStep(
                (C.INTERNAL_FEES.BINANCE_TO_LEGACY_MAX * idrAmount) / 20000000,
                tx.tokenType
            ),
            C.INTERNAL_FEES.BINANCE_TO_LEGACY_MIN
        );

            tokenUserBefore -= f1;
        }

        if (C.INTERNAL_FEES.LEGACY_TO_SEGWIT_MAX !== undefined) {
        const f2 = Math.max(
        roundToBinanceStep(
            (C.INTERNAL_FEES.LEGACY_TO_SEGWIT_MAX * idrAmount) / 20000000,
            tx.tokenType
        ),
        C.INTERNAL_FEES.LEGACY_TO_SEGWIT_MIN
        );
        tokenUserBefore -= f2;
        }

        if (C.INTERNAL_FEES.SEGWIT_TO_OPERATIONAL_MAX !== undefined) {
        const f3 = Math.max(
            roundToBinanceStep(
            (C.INTERNAL_FEES.SEGWIT_TO_OPERATIONAL_MAX * idrAmount) / 20000000,
            tx.tokenType
            ),
            C.INTERNAL_FEES.SEGWIT_TO_OPERATIONAL_MIN
        );

            tokenUserBefore -= f3;
        }

        if (C.INTERNAL_FEES.OPERATIONAL_TO_USER !== undefined) {
            tokenUserBefore -= C.INTERNAL_FEES.OPERATIONAL_TO_USER;
        }

        const tokenUser = roundToBinanceStep(tokenUserBefore, tx.tokenType);

        let refAddress: string | null = tx.refAddress ?? null;
        let refTokenAmount: number | null = null;

        const firstReferralTx = await this.transactionService.getSingleTransactionByID("", {
            where: {
                walletAddress: tx.walletAddress,
                type: 'DEPOSIT',
                status: { in: ['PAID', 'PENDING', 'COMPLETED'] },
                id: { not: tx.id },
            },
            orderBy: { createdAt: 'asc' },
            take: 1,
        });


        const recoveredRef = firstReferralTx?.refAddress;

        if (!refAddress && recoveredRef && LIFETIME_REFERRERS.has(recoveredRef)) {
            refAddress = recoveredRef;
        }

        const isLifetimeRef = refAddress && LIFETIME_REFERRERS.has(refAddress);
        const isFirstPaidDeposit = !firstReferralTx;

        if (refAddress && (isFirstPaidDeposit || isLifetimeRef)) {
        refTokenAmount = roundToBinanceStep(
            (idrRef / idrTotal) * tokenA,
            tx.tokenType
        );
        } else if (refAddress) {
        refAddress = null;
        refTokenAmount = null;
        }


        await this.transactionService.updateTransaction(tx.id, {
            cexTxId,
            tokenAmount: tokenUser,
            refAddress,
            refAmount: refTokenAmount
        });
        }
    }

    if (tx.type === 'WITHDRAWAL') {
        if (!tx.paymentDetails) return;

        if (!tx.cexTxId || !tx.idrAmount) {
            const tolerance = Math.max(
                roundToBinanceStep(C.WITHDRAW.TOLERANCE_SLIPPAGE_PERCENT * tx.tokenAmount!, tx.tokenType),
                C.WITHDRAW.TOLERANCE_SLIPPAGE_FIX
            );

            const platformFee = Math.max(
                roundToBinanceStep(C.WITHDRAW.PLATFORM_FEE_PERCENT * tx.tokenAmount!, tx.tokenType),
                C.WITHDRAW.PLATFORM_FEE_FIX
            );


        const opFee = C.INTERNAL_FEES.OPERATIONAL_TO_INDODAX ?? 0;

        const indodaxFee = roundToBinanceStep(
        (S.INDODAX_FEE_PERCENT + C.WITHDRAW.TAX_PERCENT) *
            (tx.tokenAmount! - tolerance - platformFee - opFee),
        tx.tokenType
        );

        const payoutFee = C.WITHDRAW.PAYOUT_GATEWAY_FEE;

        const binanceAmount = roundToBinanceStep(
            tx.tokenAmount! - opFee - indodaxFee - platformFee - tolerance,
            tx.tokenType
        );

        const tokenToIdr = await this.getTokenToIdrPrice(token);
        const idrAmount =
            Math.floor(binanceAmount * tokenToIdr) - payoutFee;

        const response = await this.binanceClient.marketSell(
            `${token}USDT`,
            binanceAmount
        );

        const cexTxId = String(response.orderId);

        await this.transactionService.updateTransaction(tx.id, {
            cexTxId,
            idrAmount
        });
        }

        if (!tx.xenditTxId && tx.idrAmount) {
            const createPayoutResponse = await this.xenditService.createPayout({
                amount: tx.idrAmount,
                accountNumber: (tx.paymentDetails as any).accountNumber,
                accountHolderName: (tx.paymentDetails as any).accountHolderName,
                channelCode: (tx.paymentDetails as any).channelCode,
                description: (tx.paymentDetails as any).description,
                metadata: (tx.paymentDetails as any).metadata,
                currency: "IDR"
            });

            await this.transactionService.updateTransaction(tx.id, {
                xenditTxId: createPayoutResponse.id
            });
        }

        if (tx.cexTxId && tx.xenditTxId) {
            const {status} = await this.xenditService.getPayout(tx.xenditTxId);
            if (status === "ACCEPTED") {
                await this.transactionService.updateTransaction(tx.id, {
                status: 'COMPLETED'
                });
            }
        }
    }
    }
}
