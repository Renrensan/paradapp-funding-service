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

@injectable()
export class ActionService {
  constructor(
    @inject(BinanceService) private binanceService: BinanceService,
    @inject(XenditService) private xenditService: XenditService,
    @inject(TransactionService) private transactionService: TransactionService,
    @inject(BTCService) private btcService: BTCService,
    @inject(HederaService) private hederaService: HederaService
  ) {}

  public async markPaidXenditDeposits() {
    console.log(
      "ActionService.markPaidXenditDeposits: checking waiting DEPOSITs"
    );
    const waitingTxs = await this.transactionService.getTransactions({
      where: {
        status: "WAITING",
        type: "DEPOSIT",
        xenditTxId: { not: null },
      },
    });

    for (const tx of waitingTxs) {
      console.log(
        "ActionService.markPaidXenditDeposits: checking Xendit status",
        tx.id
      );
      try {
        const paymentRequest =
          await this.xenditService.checkXenditPaymentStatus(
            tx.xenditTxId as string
          );

        const status = paymentRequest?.status;
        console.log(
          "ActionService.markPaidXenditDeposits: Xendit status =",
          status,
          tx.id
        );

        if (status === "SUCCEEDED") {
          console.log(
            "ActionService.markPaidXenditDeposits: marking TX as PAID",
            tx.id
          );
          await this.transactionService.updateTransaction(tx.id, {
            status: "PAID",
          });
        }
      } catch (err) {
        console.error(
          "ActionService.markPaidXenditDeposits: error",
          tx.id,
          err
        );
      }
    }
  }

  private async processSinglePaidTransaction(tx: Transaction) {
    console.log(
      "ActionService.processSinglePaidTransaction: start",
      tx.id,
      tx.type
    );

    const token = tx.tokenType as TokenType;
    const C = TOKEN_CONSTANTS[token];
    const S = SHARING;
    const R = REFERRAL;

    if (tx.type === "DEPOSIT") {
      console.log(
        "ActionService.processSinglePaidTransaction: processing DEPOSIT",
        tx.id
      );

      if (!tx.cexTxId || !tx.tokenAmount) {
        console.log(
          "ActionService.processSinglePaidTransaction: buying token from Binance",
          tx.id
        );

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

        console.log(
          "ActionService.processSinglePaidTransaction: Binance bought",
          tx.id
        );

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

        console.log(
          "ActionService.processSinglePaidTransaction: referral check",
          tx.id
        );

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

        console.log(
          "ActionService.processSinglePaidTransaction: updating DEPOSIT",
          tx.id
        );

        await this.transactionService.updateTransaction(tx.id, {
          cexTxId,
          tokenAmount: tokenUser,
          refAddress,
          refAmount: refTokenAmount,
        });
      }
    }

    if (tx.type === "WITHDRAWAL") {
      console.log(
        "ActionService.processSinglePaidTransaction: processing WITHDRAWAL",
        tx.id
      );

      if (!tx.paymentDetails) return;

      if (!tx.cexTxId || !tx.idrAmount) {
        console.log(
          "ActionService.processSinglePaidTransaction: selling token on Binance",
          tx.id
        );

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

        console.log(
          "ActionService.processSinglePaidTransaction: updated WITHDRAWAL Binance step",
          tx.id
        );

        await this.transactionService.updateTransaction(tx.id, {
          cexTxId,
          idrAmount,
        });
      }

      if (tx.cexTxId && tx.idrAmount && !tx.xenditTxId) {
        console.log(
          "ActionService.processSinglePaidTransaction: creating Xendit payout",
          tx.id
        );

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
        console.log(
          "ActionService.processSinglePaidTransaction: checking payout status",
          tx.id
        );

        const payoutStatus = await this.xenditService.getPayout(tx.xenditTxId);

        if (payoutStatus?.status === "ACCEPTED") {
          console.log(
            "ActionService.processSinglePaidTransaction: marking withdrawal COMPLETED",
            tx.id
          );
          await this.transactionService.updateTransaction(tx.id, {
            status: "COMPLETED",
          });
        }
      }
    }

    console.log("ActionService.processSinglePaidTransaction: end", tx.id);
  }

  public async processPaidTransactions() {
    console.log("ActionService.processPaidTransactions: start");
    const paidTxs = await this.transactionService.getTransactions({
      where: {
        status: "PAID",
      },
    });

    for (const tx of paidTxs) {
      console.log("ActionService.processPaidTransactions: processing", tx.id);
      try {
        await this.processSinglePaidTransaction(tx);
      } catch (err) {
        console.error(
          `ActionService.processPaidTransactions: failed ${tx.id}`,
          err
        );
      }
    }

    await this.sendBulkDeposits();
    await this.finalizePendingDeposits();
    console.log("ActionService.processPaidTransactions: end");
  }

  public async checkBitcoinPayments() {
    console.log("ActionService.checkBitcoinPayments: start");
    const incomingTxs = await this.btcService.getIncomingTransactions(
      this.btcService["devAddress"]
    );

    const usedTxHashes = new Set<string>();

    const waiting = await this.transactionService.getTransactions({
      where: { type: "WITHDRAWAL", status: "WAITING" },
    });

    for (const tx of waiting) {
      console.log(
        "ActionService.checkBitcoinPayments: checking WAITING withdrawal",
        tx.id
      );
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
          console.log("ActionService.checkBitcoinPayments: BTC matched", tx.id);
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
      console.log(
        "ActionService.checkBitcoinPayments: checking PENDING",
        tx.id
      );

      const stillExists = incomingTxs.find((t: any) => t.txid === tx.txHash);

      if (stillExists) {
        const confirmed = await this.btcService.isTransactionConfirmed(
          tx.txHash
        );
        if (confirmed) {
          console.log(
            "ActionService.checkBitcoinPayments: marking PAID",
            tx.id
          );
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
          console.log(
            "ActionService.checkBitcoinPayments: updated BTC hash",
            tx.id
          );
          await this.transactionService.updateTransaction(tx.id, {
            txHash: incoming.txid,
          });

          const confirmed = await this.btcService.isTransactionConfirmed(
            incoming.txid
          );

          if (confirmed) {
            console.log(
              "ActionService.checkBitcoinPayments: marking PAID",
              tx.id
            );
            await this.transactionService.updateTransaction(tx.id, {
              status: "PAID",
            });
          }
          break;
        }
      }
    }
    console.log("ActionService.checkBitcoinPayments: end");
  }

  private async sendBulkDeposits() {
    console.log("ActionService.sendBulkDeposits: start");
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
      console.log("ActionService.sendBulkDeposits: sending BTC bulk");
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
      }
    }

    const hbarDeposits = groups.HBAR || [];
    if (hbarDeposits.length) {
      console.log("ActionService.sendBulkDeposits: sending HBAR bulk");
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
        ([accountId, hbarAmount]) => ({ accountId, hbarAmount })
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
      }
    }
    console.log("ActionService.sendBulkDeposits: end");
  }

  private async finalizePendingDeposits() {
    console.log("ActionService.finalizePendingDeposits: start");

    const pendingDeposits = await this.transactionService.getTransactions({
      where: {
        status: "PENDING",
        type: "DEPOSIT",
      },
    });

    for (const tx of pendingDeposits) {
      console.log(
        "ActionService.finalizePendingDeposits: checking deposit",
        tx.id
      );
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
          console.log(
            "ActionService.finalizePendingDeposits: marking COMPLETED",
            tx.id
          );
          await this.transactionService.updateTransaction(tx.id, {
            status: "COMPLETED",
          });
        }
      } catch (err) {
        console.error(
          "ActionService.finalizePendingDeposits: error",
          tx.id,
          err
        );
      }
    }

    console.log("ActionService.finalizePendingDeposits: end");
  }
}
