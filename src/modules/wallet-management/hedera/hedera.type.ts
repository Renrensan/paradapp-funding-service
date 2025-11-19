export interface IHederaService {
  monitorNewConsensus(): Promise<[boolean, string | null]>;
  sendHBulkToUsers(
    paidDeposits: { accountId: string; hbarAmount: number }[]
  ): Promise<string>;
  isTransactionConfirmed(txid: string): Promise<boolean>;
  getIncomingTransactions(accountId: string): Promise<
    {
      txid: string;
      from: string;
      amount: number;
      confirmed: boolean;
      timestamp: string;
    }[]
  >;
}
