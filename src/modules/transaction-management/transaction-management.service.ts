import { inject, injectable } from "tsyringe";
import {
  Prisma,
  PrismaClient,
  TokenType,
  Transaction,
  TransactionType,
} from "@prisma/client";
import { DB_TOKENS } from "../../core/db/tokens";
import { ITransactionManagementService } from "./transaction-management.type";
import { XenditService } from "../xendit/xendit.service";
import {
  validateBtcAddress,
  validateHbarEvm,
  toEvmAddressIfNeeded,
} from "../../common/helper/validateAddress.helper";

@injectable()
export class TransactionService implements ITransactionManagementService {
  constructor(
    @inject(DB_TOKENS.PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(XenditService) private xendit: XenditService
  ) {}

  async handleCreateTransaction(input: any) {
    const {
      type,
      walletAddress,
      tokenAmount,
      idrAmount,
      paymentDetails,
      refAddress,
      tokenType,
    } = input;

    if (!type || !walletAddress || !tokenType) {
      return { error: "Missing required fields", status: 400 };
    }

    if (!Object.values(TransactionType).includes(type)) {
      return { error: "Invalid transaction type", status: 400 };
    }

    if (!Object.values(TokenType).includes(tokenType)) {
      return { error: "Invalid token type", status: 400 };
    }

    if (refAddress) {
      if (refAddress === walletAddress)
        return {
          error: "refAddress cannot be equal to walletAddress",
          status: 400,
        };

      if (refAddress === process.env.DEV_BTC_ADDRESS)
        return { error: "refAddress cannot be DEV wallet", status: 400 };

      if (refAddress === process.env.STORAGE_ADDRESS)
        return { error: "refAddress cannot be STORAGE wallet", status: 400 };

      if (tokenType === TokenType.BTC) {
        if (!validateBtcAddress(refAddress)) {
          return { error: "Invalid BTC referral address", status: 400 };
        }
      }

      if (tokenType === TokenType.HBAR) {
        let r = refAddress;
        if (!(await validateHbarEvm(r))) r = await toEvmAddressIfNeeded(r);
        if (!(await validateHbarEvm(r))) {
          return { error: "Invalid HBAR referral address", status: 400 };
        }
        input.refAddress = r;
      }
    }

    const existingTxs = await this.prisma.transaction.count({
      where: { type, walletAddress, status: "WAITING" },
    });

    const limitTx = type === TransactionType.DEPOSIT ? 3 : 1;

    if (existingTxs >= limitTx) {
      return {
        error: `Too many on progress ${type.toLowerCase()} transactions. Please wait for the existing ones to complete.`,
        status: 429,
      };
    }

    if (type === TransactionType.DEPOSIT) {
      if (!idrAmount || !paymentDetails?.method) {
        return {
          error: "Missing idrAmount or payment method in paymentDetails",
          status: 400,
        };
      }

      if (idrAmount < 199_000) {
        return { error: "Minimum amount is 199,000 IDR.", status: 400 };
      }

      if (idrAmount > 10_000_000 && paymentDetails.method === "QRIS") {
        return {
          error: "Using QRIS Maximum amount is 10,000,000 IDR.",
          status: 400,
        };
      }

      if (idrAmount > 20_000_000 && paymentDetails.method === "VA") {
        return {
          error: "Using VA Maximum amount is 20,000,000 IDR.",
          status: 400,
        };
      }

      if (tokenType === TokenType.BTC) {
        if (!validateBtcAddress(walletAddress)) {
          return {
            error: "Invalid Bitcoin address",
            status: 400,
          };
        }
      }

      if (tokenType === TokenType.HBAR) {
        let w = walletAddress;
        console.log(w, " ada gak sih");

        try {
          const v1 = await validateHbarEvm(w);

          if (!v1) {
            w = await toEvmAddressIfNeeded(w);
          }

          const v2 = await validateHbarEvm(w);

          if (!v2) {
            return { error: "Invalid HBAR address", status: 400 };
          }

          input.walletAddress = w;
        } catch (e) {
          return { error: "HBAR validation failed", status: 500 };
        }
      }

      const tx = await this.prisma.transaction.create({
        data: {
          type,
          walletAddress: input.walletAddress,
          idrAmount,
          tokenType,
          paymentDetails,
          refAddress: input.refAddress,
        },
      });

      let x;
      let instruction = {};

      let updatedTx = tx;
      if (paymentDetails.method === "QRIS") {
        x = await this.xendit.createQRISPaymentRequest({
          amount: idrAmount,
          referenceId: tx.id,
          description: paymentDetails.description,
        });

        updatedTx = await this.prisma.transaction.update({
          where: { id: tx.id },
          data: {
            xenditTxId: x.id,
            paymentDetails: {
              method: paymentDetails.method,
              qrString: x.paymentMethod?.qrCode?.channelProperties?.qrString,
            },
          },
        });

        instruction = {
          payWith: "QRIS",
          amountIDR: x.amount,
          qrString: x.paymentMethod?.qrCode?.channelProperties?.qrString,
          expiresAt: x.paymentMethod?.qrCode?.channelProperties?.expiresAt,
          note: "Complete the payment before expiration",
        };
      }

      if (paymentDetails.method === "VA") {
        x = await this.xendit.createPaymentRequest({
          amount: idrAmount,
          channelCode: paymentDetails.channelCode,
          referenceId: tx.id,
          customerName: paymentDetails.customerName,
          description: paymentDetails.description,
          expiresAt: paymentDetails.expiresAt,
          minPaymentAmount: paymentDetails.minPaymentAmount,
          maxPaymentAmount: paymentDetails.maxPaymentAmount,
          virtualAccountAmount: idrAmount,
        });

        updatedTx = await this.prisma.transaction.update({
          where: { id: tx.id },
          data: {
            xenditTxId: x.id,
            paymentDetails: {
              method: "VA",
              channelCode: paymentDetails.channelCode,
              vaNumber:
                x.paymentMethod?.virtualAccount?.channelProperties
                  ?.virtualAccountNumber,
            },
          },
        });

        instruction = {
          payWith: "VA",
          amountIDR: x.amount,
          vaNumber:
            x.paymentMethod?.virtualAccount?.channelProperties
              ?.virtualAccountNumber,
          expiresAt:
            x.paymentMethod?.virtualAccount?.channelProperties?.expiresAt,
          note: "Complete the payment before expiration",
        };
      }

      return { tx: updatedTx, instruction, status: 201 };
    }

    if (type === TransactionType.WITHDRAWAL) {
      if (!tokenAmount || !paymentDetails?.method) {
        return {
          error: "Missing tokenAmount or paymentDetails.method for withdrawal",
          status: 400,
        };
      }

      if (tokenType === TokenType.BTC) {
        const a = parseFloat(tokenAmount);
        if (a < 0.0002)
          return { error: "Minimum withdrawal is 0.0002 BTC.", status: 400 };
        if (a > 0.01)
          return { error: "Maximum withdrawal is 0.01 BTC.", status: 400 };
      }

      if (tokenType === TokenType.HBAR) {
        const a = parseFloat(tokenAmount);
        if (a < 0.1)
          return { error: "Minimum withdrawal is 0.1 HBAR.", status: 400 };
      }

      if (
        walletAddress === process.env.STORAGE_ADDRESS ||
        walletAddress === process.env.DEV_BTC_ADDRESS
      ) {
        return {
          error: "Storage or Dev Wallet cannot create withdrawal transaction!",
          status: 400,
        };
      }

      if (paymentDetails.method === "XENDIT_PAYOUT") {
        if (
          !paymentDetails.accountNumber ||
          !paymentDetails.accountHolderName
        ) {
          return {
            error: "Missing payout accountNumber or accountHolderName",
            status: 400,
          };
        }

        // Validate account number
        // if (typeof this.xendit.validateRecipientAlternative === "function") {
        //   const validate = await this.xendit.validateRecipientAlternative(
        //     paymentDetails.method,
        //     paymentDetails.accountNumber
        //   );
        //   if (!validate?.success) {
        //     return { error: "Withdrawal destination not found.", status: 400 };
        //   }
        // }
      }

      const tx = await this.prisma.transaction.create({
        data: {
          type,
          walletAddress,
          tokenAmount,
          tokenType,
          paymentDetails: {
            ...paymentDetails,
            bitvaultAddress: process.env.DEV_BTC_ADDRESS,
          },
        },
      });

      return {
        tx,
        instruction: {
          sendTo: process.env.DEV_BTC_ADDRESS!,
          amount: tokenAmount,
        },
        status: 201,
      };
    }

    return { error: "Invalid state", status: 400 };
  }

  async expireOldTransactions(): Promise<{ expired: number; deleted: number }> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const expired = await this.prisma.transaction.updateMany({
      where: {
        status: "WAITING",
        createdAt: { lt: tenMinutesAgo },
      },
      data: {
        status: "EXPIRED",
      },
    });

    const deleted = await this.prisma.transaction.deleteMany({
      where: {
        status: "EXPIRED",
        createdAt: { lt: weekAgo },
      },
    });

    return { expired: expired.count, deleted: deleted.count };
  }

  async getTransactions(
    args?: Prisma.TransactionFindManyArgs
  ): Promise<Transaction[]> {
    return this.prisma.transaction.findMany(args);
  }

  async getSingleTransactionByID(
    id: string,
    args?: Prisma.TransactionFindFirstArgs
  ): Promise<Transaction | null> {
    return this.prisma.transaction.findFirst({
      where: { id, ...(args?.where || {}) },
      ...args,
    });
  }

  async updateTransaction(
    id: string,
    data: Prisma.TransactionUpdateInput,
    args?: Omit<Prisma.TransactionUpdateArgs, "where" | "data">
  ): Promise<Transaction> {
    return this.prisma.transaction.update({
      where: { id },
      data,
      ...args,
    });
  }
}
