import { injectable } from "tsyringe";
import axios from "axios";
import {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  Hbar,
} from "@hashgraph/sdk";
import { toMirrorId } from "./hedera.helper";
import { HttpResponseError } from "../../../core/response/httpresponse";
import { IHederaService } from "./hedera.type";

@injectable()
export class HederaService implements IHederaService {
  private lastConsensus: string | null = null;
  private mirrorBase = process.env.MIRROR_NODE!;
  private client: Client;
  private operatorId = process.env.OPERATOR_ID!;
  private operatorKey = process.env.OPERATOR_KEY!;

  constructor() {
    if (!process.env.OPERATOR_ID)
      throw new HttpResponseError(500, "OPERATOR_ID is missing");
    if (!process.env.OPERATOR_KEY)
      throw new HttpResponseError(500, "OPERATOR_KEY is missing");
    if (!process.env.MIRROR_NODE)
      throw new HttpResponseError(500, "MIRROR_NODE is missing");

    this.operatorId = process.env.OPERATOR_ID;
    this.operatorKey = process.env.OPERATOR_KEY;
    this.mirrorBase = process.env.MIRROR_NODE;

    this.client = Client.forTestnet();
    this.client.setOperator(
      AccountId.fromString(this.operatorId),
      PrivateKey.fromStringECDSA(this.operatorKey)
    );
  }

  public async monitorNewConsensus(): Promise<[boolean, string | null]> {
    try {
      const res = await axios.get(
        `${this.mirrorBase}/transactions?order=desc&limit=1`
      );
      const latest = res.data.transactions?.[0];
      const consensus = latest?.consensus_timestamp ?? null;

      if (!consensus) return [false, this.lastConsensus];
      if (this.lastConsensus === null || consensus > this.lastConsensus)
        return [true, consensus];
      return [false, this.lastConsensus];
    } catch (err: any) {
      throw new HttpResponseError(
        err.response?.status || 500,
        "Failed to fetch latest consensus",
        err
      );
    }
  }

  public async sendHBulkToUsers(
    paidDeposits: { accountId: string; hbarAmount: number }[]
  ): Promise<string> {
    try {
      if (!paidDeposits?.length) return "";

      const total = paidDeposits.reduce((s, p) => s + p.hbarAmount, 0);
      const payer = AccountId.fromString(this.operatorId);
      const tx = new TransferTransaction();
      tx.addHbarTransfer(payer, new Hbar(-total));

      for (const p of paidDeposits) {
        const tinybars = Math.round(p.hbarAmount * 1e8);
        tx.addHbarTransfer(
          AccountId.fromString(p.accountId),
          Hbar.fromTinybars(tinybars)
        );
      }

      const signed = await tx
        .freezeWith(this.client)
        .sign(PrivateKey.fromStringECDSA(this.operatorKey));
      const response = await signed.execute(this.client);

      return response.transactionId.toString();
    } catch (err: any) {
      throw new HttpResponseError(
        err.response?.status || 500,
        "Failed to send HBAR bulk transfer",
        err
      );
    }
  }

  public async isTransactionConfirmed(txid: string): Promise<boolean> {
    try {
      const mirrorId = toMirrorId(txid);
      const res = await axios.get(
        `${this.mirrorBase}/transactions/${mirrorId}`
      );
      const tx = res.data;
      return tx?.result === "SUCCESS";
    } catch (err: any) {
      throw new HttpResponseError(
        err.response?.status || 500,
        "Failed to check transaction confirmation",
        err
      );
    }
  }

  public async getIncomingTransactions(accountId: string) {
    try {
      const res = await axios.get(
        `${this.mirrorBase}/transactions?account.id=${encodeURIComponent(
          accountId
        )}&limit=50`
      );
      const items = res.data.transactions ?? [];
      const results = [];

      for (const tx of items) {
        const timestamp = tx.consensus_timestamp
          ? new Date(
              Number(tx.consensus_timestamp.split(".")[0]) * 1000
            ).toISOString()
          : new Date().toISOString();

        const credits = (tx.transfers ?? []).filter(
          (t: any) => String(t.account) === accountId
        );

        for (const c of credits) {
          const fromEntry =
            (tx.transfers ?? []).find(
              (t: any) => t.amount === c.amount && t.account !== accountId
            ) ?? null;

          results.push({
            txid: tx.transaction_id ?? "",
            from: fromEntry?.account ?? "unknown",
            amount: Number(c.amount) / 1e8,
            confirmed: tx.result === "SUCCESS",
            timestamp,
          });
        }
      }

      return results;
    } catch (err: any) {
      throw new HttpResponseError(
        err.response?.status || 500,
        "Failed to fetch incoming transactions",
        err
      );
    }
  }
}
