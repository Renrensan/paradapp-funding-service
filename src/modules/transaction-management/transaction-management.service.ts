import { inject, injectable } from "tsyringe";
import {
  Prisma,
  PrismaClient,
  Transaction,
  TransactionType,
} from "@prisma/client";
import { DB_TOKENS } from "../../core/db/tokens";
import { ITransactionManagementService } from "./transaction-management.type";

@injectable()
export class TransactionService implements ITransactionManagementService {
  constructor(@inject(DB_TOKENS.PRISMA_CLIENT) private prisma: PrismaClient) {}

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

  async createTransaction(
    data: Prisma.TransactionCreateInput
  ): Promise<Transaction> {
    return this.prisma.transaction.create({ data });
  }

  async countTransactions(args?: Prisma.TransactionCountArgs): Promise<number> {
    return this.prisma.transaction.count(args);
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

  async countWaitingTransactions(
    type: TransactionType,
    walletAddress: string
  ): Promise<number> {
    return this.prisma.transaction.count({
      where: {
        type,
        walletAddress: walletAddress,
        status: "WAITING",
      },
    });
  }
}
