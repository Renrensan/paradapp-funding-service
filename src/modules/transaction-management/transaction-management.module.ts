import { Router } from "express";
import { container } from "tsyringe";
import { DB_TOKENS } from "../../core/db/tokens";
import prisma from "../../core/db/prismaClient";
import { TransactionService } from "./transaction-management.service";
import { TransactionController } from "./transaction.controller";
import { XenditService } from "../xendit/xendit.service";

export function registerTransactionModule(app: any) {
  // Register prisma
  if (!container.isRegistered(DB_TOKENS.PRISMA_CLIENT)) {
    container.registerInstance(DB_TOKENS.PRISMA_CLIENT, prisma);
  }

  // Register this module service
  if (!container.isRegistered(TransactionService)) {
    container.registerSingleton(TransactionService);
  }

  // Register xendit
  if (!container.isRegistered(XenditService)) {
    container.registerSingleton(XenditService);
  }

  const controller = container.resolve(TransactionController);

  const router = Router();
  router.post("/transaction", controller.createTransaction.bind(controller));

  app.use("/api", router);
}
