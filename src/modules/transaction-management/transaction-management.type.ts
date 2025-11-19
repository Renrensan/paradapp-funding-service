import { Prisma, Transaction } from "@prisma/client";

export type TransactionCreateInput = {
  type: string;
  status: string;
  tokenAmount: number;
  tokenType: string;
  idrAmount: number;
  walletAddress: string;
  paymentDetails?: string;
  txHash?: string;
  cexTxId?: string;
  refAddress?: string;
  refAmount?: number;
  xenditTxId?: string;
};

export interface ITransactionManagementService {
  getTransactions(
    args?: Prisma.TransactionFindManyArgs
  ): Promise<Transaction[]>;

  getSingleTransactionByID(
    id: string,
    args?: Prisma.TransactionFindFirstArgs
  ): Promise<Transaction | null>;

  updateTransaction(
    id: string,
    data: Prisma.TransactionUpdateInput,
    args?: Omit<Prisma.TransactionUpdateArgs, "where" | "data">
  ): Promise<Transaction>;

  expireOldTransactions(): Promise<{ expired: number; deleted: number }>;
}
