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
import {
  toEvmAddressIfNeeded,
  toNativeAddress,
} from "../../../common/helper/validateAddress.helper";

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
      const tx = res.data?.transactions?.[0];
      return tx?.result === "SUCCESS";
    } catch (err: any) {
      throw new HttpResponseError(
        err.response?.status || 500,
        "Failed to check transaction confirmation",
        err
      );
    }
  }

  public async getIncomingTransactions(userIdOrEvm: string) {
    let nativeId;

    // Detect if it's EVM or native
    if (userIdOrEvm.startsWith("0x") || userIdOrEvm.length === 42) {
      nativeId = await toNativeAddress(userIdOrEvm);
      if (!nativeId) return [];
    } else {
      nativeId = userIdOrEvm;
    }

    // We need the operator's native ID once
    const operatorNativeId = await toNativeAddress(this.operatorId);
    if (!operatorNativeId) return [];

    const results: any[] = [];
    let url =
      `${this.mirrorBase}/transactions` +
      `?account.id=${encodeURIComponent(nativeId)}` +
      `&transactiontype=cryptotransfer` +
      `&limit=100` +
      `&order=desc`;

    try {
      while (url) {
        const res = await axios.get(url);
        const transactions = res.data.transactions || [];

        for (const tx of transactions) {
          if (tx.result !== "SUCCESS") continue;

          const transfers = tx.transfers || [];
          const timestamp = tx.consensus_timestamp
            ? new Date(
                Number(tx.consensus_timestamp.split(".")[0]) * 1000
              ).toISOString()
            : new Date().toISOString();

          // 1. User must have sent HBAR (negative amount, not approval)
          const userSend = transfers.find(
            (t: any) =>
              String(t.account) === nativeId &&
              t.amount < 0 &&
              t.is_approval !== true
          );
          if (!userSend) continue;

          // 2. Operator must have received HBAR in the same transaction
          const operatorReceive = transfers.find(
            (t: any) =>
              String(t.account) === operatorNativeId &&
              t.amount > 0 &&
              t.is_approval !== true
          );
          if (!operatorReceive) continue;

          // Use the amount the operator actually received (clean, fee-free)
          const amountHbar = operatorReceive.amount / 1e8;

          // Convert addresses back to EVM format for consistency
          const fromEvm = await toEvmAddressIfNeeded(nativeId);
          const toEvm = await toEvmAddressIfNeeded(operatorNativeId);

          results.push({
            txid: tx.transaction_id,
            from: fromEvm,
            to: toEvm,
            amount: amountHbar,
            confirmed: true,
            timestamp,
          });
        }

        // Pagination
        url = res.data.links?.next
          ? this.mirrorBase + res.data.links.next.replace(/^\/api\/v1/, "")
          : "";

        // Safety break after reasonable number of pages
        if (results.length > 500) break;
      }
    } catch (error) {
      return [];
    }

    return results;
  }
}
