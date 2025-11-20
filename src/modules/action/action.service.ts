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
import { HederaService } from "../wallet-management/hedera/hedera.service";
import { logger } from "../../common/logger";
import { traceId } from "../../common/trace";
import { toEvmAddressIfNeeded } from "../../common/helper/validateAddress.helper";

@injectable()
export class ActionService {
  private readonly log = logger.child({ service: "ActionService" });

  constructor(
    @inject(BinanceService) private binanceService: BinanceService,
    @inject(XenditService) private xenditService: XenditService,
    @inject(TransactionService) private transactionService: TransactionService,
    @inject(BTCService) private btcService: BTCService,
    @inject(HederaService) private hederaService: HederaService
  ) {}

  public async markPaidXenditDeposits(_trace?: string) {
    const t = traceId(_trace);
    const lg = this.log.child({ trace: t });
    lg.info("markPaidXenditDeposits:start");

    const waitingTxs = await this.transactionService.getTransactions({
      where: {
        status: "WAITING",
        type: "DEPOSIT",
        xenditTxId: { not: null },
      },
    });

    for (const tx of waitingTxs) {
      const txLg = lg.child({ txId: tx.id });
      txLg.info("check-xendit-status:start");
      try {
        const paymentRequest =
          await this.xenditService.checkXenditPaymentStatus(
            tx.xenditTxId as string
          );
        const status = paymentRequest?.status;
        txLg.info({ status }, "check-xendit-status:result");
        if (status === "SUCCEEDED") {
          txLg.info("marking-as-PAID");
          await this.transactionService.updateTransaction(tx.id, {
            status: "PAID",
          });
        }
      } catch (err: any) {
        txLg.error({ err }, "check-xendit-status:error");
      }
    }

    lg.info("markPaidXenditDeposits:end");
  }

  private async processSinglePaidTransaction(tx: Transaction, _trace?: string) {
    const t = traceId(_trace);
    const lg = this.log.child({ trace: t, txId: tx.id });
    lg.info({ type: tx.type }, "processSinglePaidTransaction:start");

    const token = tx.tokenType as TokenType;
    const C = TOKEN_CONSTANTS[token];
    const S = SHARING;
    const R = REFERRAL;

    if (tx.type === "DEPOSIT") {
      lg.info("deposit:starting");
      if (!tx.cexTxId || !tx.tokenAmount) {
        lg.info("deposit:buying-on-binance:start");
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

        let cexTxId: string | undefined;
        let tokenAmount: number | undefined;
        try {
          const res = await this.binanceService.buyTokenFromBinance(
            token,
            idrTotal
          );
          cexTxId = res.cexTxId;
          tokenAmount = res.tokenAmount;
          lg.info({ cexTxId }, "binance:buy:success");
        } catch (err: any) {
          lg.error({ err }, "binance:buy:failed");
          throw err;
        }

        const tokenA = tokenAmount ?? 0;
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

        lg.info("deposit:updated-after-binance");
      }
    }

    if (tx.type === "WITHDRAWAL") {
      lg.info("withdrawal:starting");
      if (!tx.paymentDetails) return;

      if (!tx.cexTxId || !tx.idrAmount) {
        lg.info("withdrawal:selling-on-binance:start");

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
        const candidateAmount =
          (tx.tokenAmount ?? 0) - opFee - indodaxFee - platformFee - tolerance;
        const stepped = roundToBinanceStep(candidateAmount, tx.tokenType);

        if (stepped <= 0) {
          console.error(
            "Amount too small after fees or below Binance minQty/stepSize/notional"
          );
          console.error(
            "Check: https://www.binance.com/en/trade/rule?symbol=" +
              token +
              "USDT"
          );
          return; // skip trade
        }
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

        lg.info({ cexTxId }, "withdrawal:updated-after-binance");
      }

      if (tx.cexTxId && tx.idrAmount && !tx.xenditTxId) {
        lg.info("withdrawal:create-xendit-payout");
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

        lg.info(
          { payoutId: createPayoutResponse.id },
          "withdrawal:xendit-payout-created"
        );
      }

      if (tx.cexTxId && tx.xenditTxId) {
        lg.info("withdrawal:check-payout-status");
        const payoutStatus = await this.xenditService.getPayout(tx.xenditTxId);
        if (payoutStatus?.status === "ACCEPTED") {
          await this.transactionService.updateTransaction(tx.id, {
            status: "COMPLETED",
          });
          lg.info("withdrawal:marked-completed");
        }
      }
    }

    lg.info("processSinglePaidTransaction:end");
  }

  public async processPaidTransactions(_trace?: string) {
    const t = traceId(_trace);
    const lg = this.log.child({ trace: t });
    lg.info("processPaidTransactions:start");

    const paidTxs = await this.transactionService.getTransactions({
      where: {
        status: "PAID",
      },
    });

    for (const tx of paidTxs) {
      const txLg = lg.child({ txId: tx.id });
      txLg.info("processing-paid-tx:start");
      try {
        await this.processSinglePaidTransaction(tx, t);
        txLg.info("processing-paid-tx:done");
      } catch (err: any) {
        txLg.error({ err }, "processing-paid-tx:failed");
      }
    }

    await this.sendBulkDeposits(t);
    await this.finalizePendingDeposits(t);
    lg.info("processPaidTransactions:end");
  }

  public async checkBitcoinPayments(_trace?: string) {
    const t = traceId(_trace);
    const lg = this.log.child({ trace: t });
    lg.info("checkBitcoinPayments:start");

    const incomingTxs = await this.btcService.getIncomingTransactions(
      this.btcService["devAddress"]
    );

    const usedTxHashes = new Set<string>();

    const waiting = await this.transactionService.getTransactions({
      where: { type: "WITHDRAWAL", status: "WAITING" },
    });

    for (const tx of waiting) {
      const txLg = lg.child({ txId: tx.id });
      txLg.info("check-waiting-withdrawal");
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
          txLg.info({ incomingTx: incoming.txid }, "btc:match-found");
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
      const txLg = lg.child({ txId: tx.id });
      if (!tx.txHash) continue;
      txLg.info("check-pending-withdrawal");
      const stillExists = incomingTxs.find((t2: any) => t2.txid === tx.txHash);

      if (stillExists) {
        const confirmed = await this.btcService.isTransactionConfirmed(
          tx.txHash
        );
        if (confirmed) {
          await this.transactionService.updateTransaction(tx.id, {
            status: "PAID",
          });
          txLg.info("pending->paid");
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
            txLg.info("pending->paid:new-match");
          }
          break;
        }
      }
    }

    lg.info("checkBitcoinPayments:end");
  }

  public async checkHbarPayments(_trace?: string) {
    const t = traceId(_trace);
    const lg = this.log.child({ trace: t });
    lg.info("checkHbarPayments:start");

    const operatorEvm = await toEvmAddressIfNeeded(
      this.hederaService["operatorId"]
    );
    const usedTxIds = new Set<string>();

    const waiting = await this.transactionService.getTransactions({
      where: { type: "WITHDRAWAL", status: "WAITING" },
    });

    for (const tx of waiting) {
      const userEvm = await toEvmAddressIfNeeded(tx.walletAddress);
      const incomingTxs = await this.hederaService.getIncomingTransactions(
        userEvm
      );

      for (const incoming of incomingTxs) {
        const alreadyUsed =
          await this.transactionService.getSingleTransactionByID("", {
            where: { txHash: incoming.txid },
          });

        const txAge = Date.now() - new Date(incoming.timestamp).getTime();

        const matches =
          !alreadyUsed &&
          !usedTxIds.has(incoming.txid) &&
          incoming.from === userEvm &&
          incoming.to === operatorEvm &&
          Math.abs(incoming.amount - (tx.tokenAmount ?? 0)) < 0.00000001 &&
          txAge <= MAX_TX_AGE_MS;

        if (matches) {
          await this.transactionService.updateTransaction(tx.id, {
            status: "PENDING",
            txHash: incoming.txid,
          });

          usedTxIds.add(incoming.txid);
          break;
        }
      }
    }

    const pending = await this.transactionService.getTransactions({
      where: { type: "WITHDRAWAL", status: "PENDING" },
    });

    for (const tx of pending) {
      if (!tx.txHash) continue;

      const userEvm = await toEvmAddressIfNeeded(tx.walletAddress);
      const incomingTxs = await this.hederaService.getIncomingTransactions(
        userEvm
      );
      const existing = incomingTxs.find((i: any) => i.txid === tx.txHash);

      if (existing) {
        const confirmed = await this.hederaService.isTransactionConfirmed(
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
          !usedTxIds.has(incoming.txid) &&
          incoming.from === userEvm &&
          incoming.to === operatorEvm &&
          Math.abs(incoming.amount - (tx.tokenAmount ?? 0)) < 0.00000001 &&
          txAge <= MAX_TX_AGE_MS;

        if (matches) {
          await this.transactionService.updateTransaction(tx.id, {
            txHash: incoming.txid,
          });

          const confirmed = await this.hederaService.isTransactionConfirmed(
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

    lg.info("checkHbarPayments:end");
  }

  private async sendBulkDeposits(_trace?: string) {
    const t = traceId(_trace);
    const lg = this.log.child({ trace: t });
    lg.info("sendBulkDeposits:start");

    const paidDeposits = await this.transactionService.getTransactions({
      where: {
        status: "PAID",
        type: "DEPOSIT",
        txHash: null,
        tokenAmount: { not: null },
      },
    });

    const groups: { [key in TokenType]?: Transaction[] } = {};
    for (const tx of paidDeposits) {
      const type = tx.tokenType;
      if (!groups[type]) groups[type] = [];
      groups[type]!.push(tx);
    }

    const btcDeposits = groups.BTC || [];
    if (btcDeposits.length) {
      lg.info({ count: btcDeposits.length }, "btc:bulk-send:start");
      const btcPayload = btcDeposits.map((tx) => ({
        id: tx.id,
        btcAmount: tx.tokenAmount,
        btcAddress: tx.walletAddress,
        refBtcAmount: tx.refAmount,
        refBtcAddress: tx.refAddress,
      }));
      const btcTxHash = await this.btcService.sendBTCBulkToUsers(btcPayload);
      if (btcTxHash) {
        await Promise.all(
          btcDeposits.map((tx) =>
            this.transactionService.updateTransaction(tx.id, {
              txHash: btcTxHash,
              status: "PENDING",
            })
          )
        );
        lg.info({ txHash: btcTxHash }, "btc:bulk-send:done");
      } else {
        lg.warn("btc:bulk-send:no-txhash");
      }
    }

    const hbarDeposits = groups.HBAR || [];
    if (hbarDeposits.length) {
      lg.info({ count: hbarDeposits.length }, "hbar:bulk-send:start");
      const transfers: { [accountId: string]: number } = {};
      for (const tx of hbarDeposits) {
        const addr = tx.walletAddress;
        const amt = tx.tokenAmount || 0;
        transfers[addr] = (transfers[addr] || 0) + amt;
        if (tx.refAddress && tx.refAmount) {
          const refAddr = tx.refAddress;
          const refAmt = tx.refAmount;
          transfers[refAddr] = (transfers[refAddr] || 0) + refAmt;
        }
      }
      const payload = Object.entries(transfers).map(
        ([accountId, hbarAmount]) => ({
          accountId,
          hbarAmount,
        })
      );
      const hbarTxId = await this.hederaService.sendHBulkToUsers(payload);
      if (hbarTxId) {
        await Promise.all(
          hbarDeposits.map((tx) =>
            this.transactionService.updateTransaction(tx.id, {
              txHash: hbarTxId,
              status: "PENDING",
            })
          )
        );
        lg.info({ txHash: hbarTxId }, "hbar:bulk-send:done");
      } else {
        lg.warn("hbar:bulk-send:no-txid");
      }
    }

    lg.info("sendBulkDeposits:end");
  }

  private async finalizePendingDeposits(_trace?: string) {
    const t = traceId(_trace);
    const lg = this.log.child({ trace: t });
    lg.info("finalizePendingDeposits:start");

    const pendingDeposits = await this.transactionService.getTransactions({
      where: {
        status: "PENDING",
        type: "DEPOSIT",
      },
    });

    for (const tx of pendingDeposits) {
      const txLg = lg.child({ txId: tx.id });
      txLg.info("finalize:checking");
      try {
        if (!tx.txHash) continue;

        let confirmed: boolean;
        if (tx.tokenType === "BTC") {
          confirmed = await this.btcService.isTransactionConfirmed(tx.txHash);
        } else if (tx.tokenType === "HBAR") {
          confirmed = await this.hederaService.isTransactionConfirmed(
            tx.txHash
          );
        } else {
          continue;
        }

        if (confirmed) {
          await this.transactionService.updateTransaction(tx.id, {
            status: "COMPLETED",
          });
          txLg.info("finalize:marked-completed");
        }
      } catch (err: any) {
        txLg.error({ err }, "finalize:error");
      }
    }

    lg.info("finalizePendingDeposits:end");
  }
}
