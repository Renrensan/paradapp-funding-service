import { Request, Response } from "express";
import { inject, injectable } from "tsyringe";
import { TransactionService } from "./transaction-management.service";
import { XenditService } from "../xendit/xendit.service";

@injectable()
export class TransactionController {
  constructor(
    @inject(TransactionService) private service: TransactionService
  ) {}

  async createTransaction(req: Request, res: Response) {
    try {
      const result = await this.service.handleCreateTransaction(req.body);
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }

      return res.status(result.status).json({
        success: true,
        tx: result.tx,
        instruction: result.instruction,
      });
    } catch {
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
