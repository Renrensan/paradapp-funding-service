import { container } from "tsyringe";
import { BTC_TOKENS } from "./tokens";

import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as tinysecp from "tiny-secp256k1";
import * as ecc from "tiny-secp256k1";
import { BTCService } from "./btc.service";

bitcoin.initEccLib(ecc);

export function registerBTCModule() {
  const ECPair = ECPairFactory(tinysecp);

  const networkType = process.env.BTC_NETWORK || "testnet";
  const network =
    networkType === "mainnet"
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

  const DEV_WIF = process.env.DEV_WIF;
  if (!DEV_WIF) throw new Error("Missing DEV_WIF");

  const keyPair = ECPair.fromWIF(DEV_WIF, network);

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network,
  });

  if (!address) throw new Error("Cannot derive developer BTC address");

  const MEMPOOL_API =
    networkType === "mainnet"
      ? "https://mempool.space/api"
      : "https://mempool.space/testnet/api";

  if (!MEMPOOL_API) throw new Error("Missing MEMPOOL_API");

  container.registerInstance(BTC_TOKENS.BTCNetwork, network);
  container.registerInstance(BTC_TOKENS.BTCKeyPair, keyPair);
  container.registerInstance(BTC_TOKENS.BTCDevAddress, address);
  container.registerInstance(BTC_TOKENS.MempoolApi, MEMPOOL_API);

  container.registerSingleton(BTC_TOKENS.BTCService, BTCService);
}
