import { container } from "tsyringe";
import { DB_TOKENS } from "../../core/db/tokens";
import { TransactionService } from "./transaction-management.service";
import prisma from "../../core/db/prismaClient";

export function registerTransactionModule() {
  // Register Prisma client if not already registered
  if (!container.isRegistered(DB_TOKENS.PRISMA_CLIENT)) {
    container.registerInstance(DB_TOKENS.PRISMA_CLIENT, prisma);
  }

  // Register Transaction service
  container.registerSingleton(TransactionService);
}
