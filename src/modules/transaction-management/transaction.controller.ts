import { Request, Response } from "express";
import { inject, injectable } from "tsyringe";
import { TransactionService } from "./transaction-management.service";

@injectable()
export class TransactionController {
  constructor(
    @inject(TransactionService) private service: TransactionService
  ) {}

  async createTransaction(req: Request, res: Response) {
    try {
      const result = await this.service.handleCreateTransaction(req.body);
      if (result.error)
        return res.status(result.status).json({ error: result.error });
      return res
        .status(result.status)
        .json({
          success: true,
          tx: result.tx,
          instruction: result.instruction,
        });
    } catch {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  async getMetrics(req: Request, res: Response) {
    try {
      const data = await this.service.getMetrics();
      res.status(200).json({ success: true, ...data });
    } catch (error) {
      console.error("Error fetching metrics:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  async getTransactionById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const tx = await this.service.getTransactionPublic(id);
      if (!tx)
        return res
          .status(404)
          .json({ success: false, error: "Transaction not found" });
      res.status(200).json({ success: true, transaction: tx });
    } catch (error) {
      console.error("Error fetching transaction by ID:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  async getTransactionsByAddress(req: Request, res: Response) {
    try {
      const { walletAddress } = req.params;
      const transactions = await this.service.getTransactionsByAddress(
        walletAddress
      );
      res.status(200).json({ success: true, transactions });
    } catch (error) {
      console.error("Error fetching transactions by address:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  async getReferralHistory(req: Request, res: Response) {
    try {
      const { walletAddress } = req.params;
      const referralHistory = await this.service.getReferralHistory(
        walletAddress
      );
      res.status(200).json({ success: true, referralHistory });
    } catch (error) {
      console.error("Error fetching referral history:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  async getSubscriptionStatus(req: Request, res: Response) {
    try {
      const { walletAddress } = req.params;
      const { active, expiry, expiresIn } =
        await this.service.getSubscriptionStatus(walletAddress);
      res.status(200).json({ success: true, active, expiry, expiresIn });
    } catch (error) {
      console.error("Subscription calc error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  async validateRecipient(req: Request, res: Response) {
    try {
      const { method, accountNumber } = req.body;
      if (!method || !accountNumber) {
        return res
          .status(400)
          .json({ success: false, error: "Missing method or accountNumber" });
      }

      const result = await this.service.validateRecipient(
        method,
        accountNumber
      );
      if (!result.valid) {
        return res.status(400).json({ success: false, error: result.error });
      }

      res
        .status(200)
        .json({
          success: true,
          data: { account_holder: result.account_holder },
        });
    } catch (error: any) {
      console.error("Recipient validation error:", error.message);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
}
