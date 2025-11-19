import { injectable, inject } from "tsyringe";
import axios from "axios";
import * as bitcoin from "bitcoinjs-lib";
import { BTC_TOKENS } from "./tokens";

@injectable()
export class BTCService {
  private lastBlockHeight = 0;

  constructor(
    @inject(BTC_TOKENS.BTCNetwork) private network: bitcoin.Network,
    @inject(BTC_TOKENS.BTCKeyPair) private keyPair: any,
    @inject(BTC_TOKENS.BTCDevAddress) private devAddress: string,
    @inject(BTC_TOKENS.MempoolApi) private MEMPOOL_API: string
  ) {}

  // === Block detection ===
  public async monitorNewBlocks(): Promise<[boolean, number]> {
    const res = await axios.get(`${this.MEMPOOL_API}/blocks`);
    const latest = res.data[0];

    if (latest.height > this.lastBlockHeight) {
      return [true, latest.height];
    }
    return [false, this.lastBlockHeight];
  }

  // === BULK SENDING BTC ===
  public async sendBTCBulkToUsers(paidDeposits: any[]): Promise<string> {
    const [hasNewBlock, newHeight] = await this.monitorNewBlocks();
    if (!hasNewBlock || !paidDeposits.length) return "";

    const feeRes = await axios.get(`${this.MEMPOOL_API}/v1/fees/recommended`);
    const dynamicRate = Math.ceil(feeRes.data.economyFee || 1);
    const feeRate = Math.max(1, Math.min(dynamicRate, 2));

    // Fetch UTXO
    const utxoRes = await axios.get(
      `${this.MEMPOOL_API}/address/${this.devAddress}/utxo`
    );
    const utxos = utxoRes.data;
    if (!utxos.length) throw new Error("No UTXOs available");

    const psbt = new bitcoin.Psbt({ network: this.network });

    // Calculate sum to send
    const totalSend = paidDeposits.reduce((sum: number, tx) => {
      const main = Math.floor(tx.btcAmount * 1e8);
      const ref = tx.refBtcAmount ? Math.floor(tx.refBtcAmount * 1e8) : 0;
      return sum + main + ref;
    }, 0);

    // Select UTXO
    let inputSum = 0;
    let finalFee = 0;
    const selected: any[] = [];

    for (const utxo of utxos) {
      selected.push(utxo);
      inputSum += utxo.value;

      const estVBytes =
        selected.length * 59 + (paidDeposits.length + 1) * 31 + 10;
      finalFee = Math.ceil(estVBytes * feeRate);
      finalFee = Math.max(300, Math.min(finalFee, 800));

      if (inputSum >= totalSend + finalFee) break;
    }

    if (inputSum < totalSend + finalFee) throw new Error("Not enough UTXOs");
    const change = inputSum - totalSend - finalFee;

    // Add Inputs
    selected.forEach((u) =>
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(this.devAddress, this.network),
          value: BigInt(u.value),
        },
      })
    );

    // Add Outputs
    paidDeposits.forEach((tx) => {
      psbt.addOutput({
        address: tx.btcAddress,
        value: BigInt(Math.floor(tx.btcAmount * 1e8)),
      });

      if (tx.refBtcAddress && tx.refBtcAmount) {
        psbt.addOutput({
          address: tx.refBtcAddress,
          value: BigInt(Math.floor(tx.btcAmount * 1e8)),
        });
      }
    });

    if (change > 0) {
      psbt.addOutput({ address: this.devAddress, value: BigInt(change) });
    }

    // Sign
    psbt.signAllInputs(this.keyPair);
    psbt.finalizeAllInputs();

    const txHex = psbt.extractTransaction().toHex();

    try {
      const broadcast = await axios.post(`${this.MEMPOOL_API}/tx`, txHex, {
        headers: { "Content-Type": "text/plain" },
      });

      this.lastBlockHeight = newHeight;
      return broadcast.data;
    } catch (err: any) {
      console.error("Broadcast failed:", err.response?.data || err.message);
      throw err;
    }
  }

  // === Check confirmation ===
  public async isTransactionConfirmed(txid: string): Promise<boolean> {
    const res = await axios.get(`${this.MEMPOOL_API}/tx/${txid}/status`);
    return res.data.confirmed;
  }

  // === Detect Incoming ===
  public async getIncomingTransactions(address: string) {
    const res = await axios.get(`${this.MEMPOOL_API}/address/${address}/txs`);
    const txs = res.data;

    return txs
      .filter((tx: any) =>
        tx.vout.some((v: any) => v.scriptpubkey_address === address)
      )
      .map((tx: any) => {
        const output = tx.vout.find(
          (v: any) => v.scriptpubkey_address === address
        );
        const from = tx.vin[0]?.prevout?.scriptpubkey_address || "unknown";

        return {
          txid: tx.txid,
          from,
          amount: output.value / 1e8,
          confirmed: tx.status.confirmed,
          timestamp: tx.status.block_time
            ? new Date(tx.status.block_time * 1000).toISOString()
            : new Date().toISOString(),
        };
      });
  }
}
