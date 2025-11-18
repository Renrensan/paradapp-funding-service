import { inject, injectable } from "tsyringe";
import { Prisma, PrismaClient, Transaction } from "@prisma/client";
import { DB_TOKENS } from "../../core/db/tokens";
import { ITransactionManagementService } from "./transaction-management.type";

@injectable()
export class TransactionService implements ITransactionManagementService {
  constructor(
    @inject(DB_TOKENS.PRISMA_CLIENT) private prisma: PrismaClient
  ) {}

  async getTransactions(args?: Prisma.TransactionFindManyArgs): Promise<Transaction[]> {
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
