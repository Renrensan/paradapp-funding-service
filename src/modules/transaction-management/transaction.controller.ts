import { Router, Request, Response } from "express";
import { container } from "tsyringe";
import { TransactionType, TokenType } from "@prisma/client";
import { TransactionService } from "./transaction-management.service";
import { XenditService } from "../xendit/xendit.service";

export const transactionRouter = Router();

const transactionService =
  container.resolve<TransactionService>(TransactionService);
const xenditService = container.resolve<XenditService>(XenditService);

const DEV_WALLET_ADDRESS = process.env.DEV_ADDRESS!;
const STORAGE_WALLET_ADDRESS = process.env.STORAGE_ADDRESS!;

transactionRouter.post("/transaction", async (req: Request, res: Response) => {
  try {
    const {
      type,
      walletAddress,
      tokenAmount,
      idrAmount,
      paymentDetails,
      refAddress,
      tokenType,
    } = req.body;

    // Basic validation
    if (!type || !walletAddress || !tokenType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!Object.values(TransactionType).includes(type)) {
      return res.status(400).json({ error: "Invalid transaction type" });
    }

    if (!Object.values(TokenType).includes(tokenType)) {
      return res.status(400).json({ error: "Invalid token type" });
    }

    // Count existing WAITING transactions
    const existingTxs = await transactionService.countWaitingTransactions(
      type,
      walletAddress
    );
    const limitTx = type === TransactionType.DEPOSIT ? 3 : 1;

    if (existingTxs >= limitTx) {
      return res.status(429).json({
        error: `Too many on progress ${type.toLowerCase()} transactions. Please wait for the existing ones to complete.`,
      });
    }

    // -------------------------------
    // DEPOSIT FLOW
    // -------------------------------
    if (type === TransactionType.DEPOSIT) {
      if (!idrAmount || !paymentDetails?.method) {
        return res.status(400).json({
          error: "Missing idrAmount or payment method in paymentDetails",
        });
      }

      // Validate IDR ranges
      if (idrAmount < 199_000) {
        return res
          .status(400)
          .json({ error: "Minimum amount is 199,000 IDR." });
      }

      if (idrAmount > 10_000_000 && paymentDetails.method === "QRIS") {
        return res
          .status(400)
          .json({ error: "Using QRIS Maximum amount is 10,000,000 IDR." });
      }

      if (idrAmount > 20_000_000 && paymentDetails.method === "VA") {
        return res
          .status(400)
          .json({ error: "Using VA Maximum amount is 20,000,000 IDR." });
      }

      // BTC-specific address validation
      if (tokenType === TokenType.BTC) {
        const btcPrefix = walletAddress.slice(0, 4);
        const validPrefixes = ["bc1q", "bc1p"];
        const validChars = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;

        if (
          !validPrefixes.includes(btcPrefix) ||
          walletAddress.length < 42 ||
          walletAddress.length > 62 ||
          !validChars.test(walletAddress.slice(3))
        ) {
          return res.status(400).json({
            error:
              "Invalid Bitcoin address. Must start with bc1q or bc1p, be 42-62 chars, and use lowercase alphanumeric only.",
          });
        }
      }

      // Create transaction in DB
      const tx = await transactionService.createTransaction({
        type,
        walletAddress,
        idrAmount,
        tokenType,
        paymentDetails,
        refAddress,
      });

      // Call XenditService for payment request
      let xenditPayment;
      let instruction: any = {};

      if (paymentDetails.method === "QRIS") {
        xenditPayment = await xenditService.createQRISPaymentRequest({
          amount: idrAmount,
          referenceId: tx.id,
          description: paymentDetails.description,
        });
        await transactionService.updateTransaction(tx.id, {
          xenditTxId: xenditPayment.id,
          paymentDetails: {
            method: paymentDetails.method,
            qrString:
              xenditPayment.paymentMethod?.qrCode?.channelProperties?.qrString,
          },
        });

        instruction = {
          payWith: "QRIS",
          amountIDR: xenditPayment.amount,
          qrString: xenditPayment.paymentMethod?.qrCode?.channelProperties?.qrString,
          expiresAt:
            xenditPayment.paymentMethod?.qrCode?.channelProperties?.expiresAt,
          note: "Complete the payment before expiration",
        };
      } else if (paymentDetails.method === "VA") {
        xenditPayment = await xenditService.createPaymentRequest({
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
        await transactionService.updateTransaction(tx.id, {
          xenditTxId: xenditPayment.id,
          paymentDetails: {
            method: "VA",
            channelCode: paymentDetails.channelCode,
            vaNumber:
              xenditPayment.paymentMethod?.virtualAccount?.channelProperties
                ?.virtualAccountNumber,
          },
        });

        instruction = {
          payWith: "VA",
          amountIDR: xenditPayment.amount,
          vaNumber:
            xenditPayment.paymentMethod?.virtualAccount?.channelProperties
              ?.virtualAccountNumber,
          expiresAt:
            xenditPayment.paymentMethod?.virtualAccount?.channelProperties?.expiresAt,
          note: "Complete the payment before expiration",
        };
      }

      return res.status(201).json({ success: true, tx, instruction });
    }

    // -------------------------------
    // WITHDRAWAL FLOW
    // -------------------------------
    if (type === TransactionType.WITHDRAWAL) {
      if (!tokenAmount || !paymentDetails?.method) {
        return res.status(400).json({
          error: "Missing tokenAmount or paymentDetails.method for withdrawal",
        });
      }

      // BTC withdrawal limits
      if (tokenType === TokenType.BTC) {
        const amount = parseFloat(tokenAmount);
        if (amount < 0.0002) {
          return res
            .status(400)
            .json({ error: "Minimum withdrawal is 0.0002 BTC." });
        }
        if (amount > 0.01) {
          return res
            .status(400)
            .json({ error: "Maximum withdrawal is 0.01 BTC." });
        }
      }

      // HBAR withdrawal limits
      if (tokenType === TokenType.HBAR) {
        const amount = parseFloat(tokenAmount);
        if (amount < 0.1) {
          return res
            .status(400)
            .json({ error: "Minimum withdrawal is 0.1 HBAR." });
        }
      }

      // Optionally validate recipient with Xendit for fiat payouts
      if (paymentDetails.method === "XENDIT_PAYOUT") {
        const validate = await xenditService.createPayout({
          accountNumber: paymentDetails.accountNumber,
          accountHolderName: paymentDetails.accountHolderName,
          channelCode: paymentDetails.channelCode,
          amount: parseFloat(tokenAmount),
          currency: paymentDetails.currency,
        });
      }

      const tx = await transactionService.createTransaction({
        type,
        walletAddress,
        tokenAmount,
        tokenType,
        paymentDetails,
      });

      return res.status(201).json({
        success: true,
        tx,
        instruction: {
          sendTo: DEV_WALLET_ADDRESS,
          amount: tokenAmount,
        },
      });
    }
  } catch (err) {
    console.error("❌ Transaction controller error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
