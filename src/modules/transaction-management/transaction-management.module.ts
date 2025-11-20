import { Router } from "express";
import { container } from "tsyringe";
import { DB_TOKENS } from "../../core/db/tokens";
import prisma from "../../core/db/prismaClient";
import { TransactionService } from "./transaction-management.service";
import { XenditService } from "../xendit/xendit.service";
import { TransactionController } from "./transaction.controller";

export function registerTransactionModule(app: any) {
  if (!container.isRegistered(DB_TOKENS.PRISMA_CLIENT)) {
    container.registerInstance(DB_TOKENS.PRISMA_CLIENT, prisma);
  }

  if (!container.isRegistered(TransactionService)) {
    container.registerSingleton(TransactionService);
  }

  if (!container.isRegistered(XenditService)) {
    container.registerSingleton(XenditService);
  }

  const controller = container.resolve(TransactionController);
  const router = Router();

  router.post("/transaction", controller.createTransaction.bind(controller));

  router.get("/transaction/metrics", controller.getMetrics.bind(controller));

  router.get(
    "/transaction/:id",
    controller.getTransactionById.bind(controller)
  );

  router.get(
    "/transaction/address/:walletAddress",
    controller.getTransactionsByAddress.bind(controller)
  );

  router.get(
    "/transaction/referral/:walletAddress",
    controller.getReferralHistory.bind(controller)
  );

  router.get(
    "/transaction/subscription/:walletAddress",
    controller.getSubscriptionStatus.bind(controller)
  );

  router.post(
    "/transaction/validate-recipient",
    controller.validateRecipient.bind(controller)
  );

  app.use("/api", router);
}
