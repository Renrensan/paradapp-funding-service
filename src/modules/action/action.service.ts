import { inject, injectable } from "tsyringe";
import { TokenType, Transaction } from "@prisma/client";
import { BinanceService } from "../binance/binance.service";
import { XenditService } from "../xendit/xendit.service";
import { TransactionService } from "../transaction-management/transaction-management.service";
import { LIFETIME_REFERRERS } from "../../common/common.const";
import { roundToBinanceStep } from "../binance/binance.helper";
import { REFERRAL, SHARING, TOKEN_CONSTANTS } from "../../common/fee.const";
import { BTCService } from "../wallet-management/btc/btc.service";
import { MAX_TX_AGE_MS } from "../../common/limitations.const";

@injectable()
export class ActionService {
  constructor(
    @inject(BinanceService) private binanceService: BinanceService,
    @inject(XenditService) private xenditService: XenditService,
    @inject(TransactionService) private transactionService: TransactionService,
    @inject(BTCService) private btcService: BTCService
  ) {}

  async markPaidXenditDeposits() {
    const waitingTxs = await this.transactionService.getTransactions({
      where: {
        status: "WAITING",
        type: "DEPOSIT",
        xenditTxId: { not: null },
      },
    });

    for (const tx of waitingTxs) {
      try {
        const paymentRequest =
          await this.xenditService.checkXenditPaymentStatus(
            tx.xenditTxId as string
          );
        const status = paymentRequest?.status;
        const isSuccess = status === "SUCCEEDED";
        if (isSuccess) {
          await this.transactionService.updateTransaction(tx.id, {
            status: "PAID",
          });
        }
      } catch (err) {
        console.error(err);
      }
    }
  }

  private async processSinglePaidTransaction(tx: Transaction) {
    const token = tx.tokenType as TokenType;
    const C = TOKEN_CONSTANTS[token];
    const S = SHARING;
    const R = REFERRAL;

    if (tx.type === "DEPOSIT") {
      if (!tx.cexTxId || !tx.tokenAmount) {
        const idrAmount = tx.idrAmount ?? 0;
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

        const idrUserBeforeOnChainFee =
          idrTotal - platformFee - toleranceSlippage;

        const idrRef = Math.max(
          R.REWARD_MIN,
          Math.floor(idrAmount * R.REWARD_PERCENT)
        );

        const { cexTxId, tokenAmount } =
          await this.binanceService.buyTokenFromBinance(token, idrTotal);

        const tokenA = tokenAmount;
        let tokenUserBefore =
          idrTotal === 0 ? 0 : (idrUserBeforeOnChainFee / idrTotal) * tokenA;

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
              (C.INTERNAL_FEES.SEGWIT_TO_OPERATIONAL_MAX * idrAmount) /
                20000000,
              tx.tokenType
            ),
            C.INTERNAL_FEES.SEGWIT_TO_OPERATIONAL_MIN
          );
          tokenUserBefore -= f3;
        }

        if (C.INTERNAL_FEES.OPERATIONAL_TO_USER !== undefined) {
          tokenUserBefore -= C.INTERNAL_FEES.OPERATIONAL_TO_USER;
        }

        const tokenUser = roundToBinanceStep(
          tokenUserBefore,
          tx.tokenType,
          true
        );

        let refAddress: string | null = tx.refAddress ?? null;
        let refTokenAmount: number | null = null;

        const firstReferralTx =
          await this.transactionService.getSingleTransactionByID("", {
            where: {
              walletAddress: tx.walletAddress,
              type: "DEPOSIT",
              status: { in: ["PAID", "PENDING", "COMPLETED"] },
              id: { not: tx.id },
            },
            orderBy: { createdAt: "asc" },
            take: 1,
          });

        const recoveredRef = firstReferralTx?.refAddress;

        if (
          !refAddress &&
          recoveredRef &&
          LIFETIME_REFERRERS.has(recoveredRef)
        ) {
          refAddress = recoveredRef;
        }

        const isLifetimeRef =
          !!refAddress && LIFETIME_REFERRERS.has(refAddress);
        const isFirstPaidDeposit = !firstReferralTx;

        if (refAddress && (isFirstPaidDeposit || isLifetimeRef)) {
          refTokenAmount = roundToBinanceStep(
            (idrRef / idrTotal) * tokenA,
            tx.tokenType,
            true
          );
        } else if (refAddress) {
          refAddress = null;
          refTokenAmount = null;
        }

        await this.transactionService.updateTransaction(tx.id, {
          cexTxId,
          tokenAmount: tokenUser,
          refAddress,
          refAmount: refTokenAmount,
        });
      }
    }

    if (tx.type === "WITHDRAWAL") {
      if (!tx.paymentDetails) return;

      if (!tx.cexTxId || !tx.idrAmount) {
        const tolerance = Math.max(
          roundToBinanceStep(
            C.WITHDRAW.TOLERANCE_SLIPPAGE_PERCENT * (tx.tokenAmount ?? 0),
            tx.tokenType
          ),
          C.WITHDRAW.TOLERANCE_SLIPPAGE_FIX
        );

        const platformFee = Math.max(
          roundToBinanceStep(
            C.WITHDRAW.PLATFORM_FEE_PERCENT * (tx.tokenAmount ?? 0),
            tx.tokenType
          ),
          C.WITHDRAW.PLATFORM_FEE_FIX
        );

        const opFee = C.INTERNAL_FEES.OPERATIONAL_TO_INDODAX ?? 0;

        const indodaxFee = roundToBinanceStep(
          (S.INDODAX_FEE_PERCENT + C.WITHDRAW.TAX_PERCENT) *
            ((tx.tokenAmount ?? 0) - tolerance - platformFee - opFee),
          tx.tokenType
        );

        const payoutFee = C.WITHDRAW.PAYOUT_GATEWAY_FEE;

        const binanceAmount = roundToBinanceStep(
          (tx.tokenAmount ?? 0) - opFee - indodaxFee - platformFee - tolerance,
          tx.tokenType
        );

        const tokenToIdr = await this.binanceService.getTokenToIdrPrice(token);
        const idrAmount = Math.floor(binanceAmount * tokenToIdr) - payoutFee;

        const response = await this.binanceService.sellTokenFromBinance(
          token,
          binanceAmount
        );
        const cexTxId = String(response.cexTxId ?? response);

        await this.transactionService.updateTransaction(tx.id, {
          cexTxId,
          idrAmount,
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
          currency: "IDR",
        });

        await this.transactionService.updateTransaction(tx.id, {
          xenditTxId: createPayoutResponse.id,
        });
      }

      if (tx.cexTxId && tx.xenditTxId) {
        const payoutStatus = await this.xenditService.getPayout(tx.xenditTxId);
        if (payoutStatus?.status === "ACCEPTED") {
          await this.transactionService.updateTransaction(tx.id, {
            status: "COMPLETED",
          });
        }
      }
    }
  }

  async processPaidTransactions() {
    const paidTxs = await this.transactionService.getTransactions({
      where: {
        status: "PAID",
      },
    });

    for (const tx of paidTxs) {
      try {
        await this.processSinglePaidTransaction(tx);
      } catch (err) {
        console.error(`Failed processing TX ${tx.id}`, err);
      }
    }
  }

  async checkBitcoinPayments() {
    const incomingTxs = await this.btcService.getIncomingTransactions(
      this.btcService["devAddress"]
    );

    const usedTxHashes = new Set<string>();

    const waiting = await this.transactionService.getTransactions({
      where: { type: "WITHDRAWAL", status: "WAITING" },
    });

    for (const tx of waiting) {
      for (const incoming of incomingTxs) {
        const alreadyUsed =
          await this.transactionService.getSingleTransactionByID("", {
            where: { txHash: incoming.txid },
          });

        const txAge = Date.now() - new Date(incoming.timestamp).getTime();

        const matches =
          !alreadyUsed &&
          !usedTxHashes.has(incoming.txid) &&
          incoming.from === tx.walletAddress &&
          Math.abs(incoming.amount - (tx.tokenAmount ?? 0)) < 0.00000001 &&
          txAge <= MAX_TX_AGE_MS;

        if (matches) {
          await this.transactionService.updateTransaction(tx.id, {
            status: "PENDING",
            txHash: incoming.txid,
          });

          usedTxHashes.add(incoming.txid);
          break;
        }
      }
    }

    const pending = await this.transactionService.getTransactions({
      where: { type: "WITHDRAWAL", status: "PENDING" },
    });

    for (const tx of pending) {
      if (!tx.txHash) continue;

      const stillExists = incomingTxs.find((t: any) => t.txid === tx.txHash);

      if (stillExists) {
        const confirmed = await this.btcService.isTransactionConfirmed(
          tx.txHash
        );
        if (confirmed) {
          await this.transactionService.updateTransaction(tx.id, {
            status: "PAID",
          });
        }
        continue;
      }

      for (const incoming of incomingTxs) {
        const alreadyUsed =
          await this.transactionService.getSingleTransactionByID("", {
            where: { txHash: incoming.txid },
          });

        const txAge = Date.now() - new Date(incoming.timestamp).getTime();

        const matches =
          !alreadyUsed &&
          !usedTxHashes.has(incoming.txid) &&
          incoming.from === tx.walletAddress &&
          Math.abs(incoming.amount - (tx.tokenAmount ?? 0)) < 0.00000001 &&
          txAge <= MAX_TX_AGE_MS;

        if (matches) {
          await this.transactionService.updateTransaction(tx.id, {
            txHash: incoming.txid,
          });

          const confirmed = await this.btcService.isTransactionConfirmed(
            incoming.txid
          );

          if (confirmed) {
            await this.transactionService.updateTransaction(tx.id, {
              status: "PAID",
            });
          }
          break;
        }
      }
    }
  }
}
