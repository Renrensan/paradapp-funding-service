import { container } from "tsyringe";
import { DB_TOKENS } from "../../core/db/tokens";
import { TransactionService } from "./transaction-management.service";
import prisma from "../../core/db/prismaClient";
import { transactionRouter } from "./transaction.controller";

export function registerTransactionModule(app: any) {
  if (!container.isRegistered(DB_TOKENS.PRISMA_CLIENT)) {
    container.registerInstance(DB_TOKENS.PRISMA_CLIENT, prisma);
  }

  if (!container.isRegistered(TransactionService)) {
    container.registerSingleton(TransactionService);
  }

  // Mount transaction routes
  app.use("/api", transactionRouter);
}
