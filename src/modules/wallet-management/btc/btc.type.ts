export interface IBTCService {
  monitorNewBlocks(): Promise<[boolean, number]>;
  sendBTCBulkToUsers(paidDeposits: any[]): Promise<string>;
  isTransactionConfirmed(txid: string): Promise<boolean>;
  getIncomingTransactions(address: string): Promise<any>;
}
