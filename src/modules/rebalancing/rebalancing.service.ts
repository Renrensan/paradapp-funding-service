import { injectable, inject } from "tsyringe";
import { XENDIT_TOKENS } from "../xendit/tokens";
import { INDODAX_TOKENS } from "../indodax/tokens";
import { BINANCE_TOKENS } from "../binance/tokens";
import { XenditService } from "../xendit/xendit.service";
import { IndodaxService } from "../indodax/indodax.service";
import { BinanceService } from "../binance/binance.service";
import { PayoutDTO } from "../xendit/dto/payment-request.dto";
import { rebalanceThreshold } from "../../common/rebalance.const";
import { BTCService } from "../wallet-management/btc/btc.service";
import { BTC_TOKENS } from "../wallet-management/btc/tokens";

@injectable()
export class RebalanceService {
  constructor(
    @inject(XENDIT_TOKENS.XenditService) private xenditService: XenditService,
    @inject(INDODAX_TOKENS.INDODAX_SERVICE)
    private indodaxService: IndodaxService,
    @inject(BINANCE_TOKENS.BINANCE_SERVICE)
    private binanceService: BinanceService,
    @inject(BINANCE_TOKENS.BINANCE_CLIENT) private binanceClient: any,
    @inject(BTC_TOKENS.BTCService) private btcService: BTCService
  ) {}

  private async getXenditBalance(): Promise<number> {
    const balanceResponse = await this.xenditService.getBalance();
    return balanceResponse.balance || balanceResponse; // Adjust based on actual response structure
  }

  async rebalance(): Promise<void> {
    const threshold = rebalanceThreshold.xendit;
    const balance = await this.getXenditBalance();

    if (balance <= threshold) {
      await this.rebalanceLow();
    } else {
      await this.rebalanceHigh();
    }
  }

  private async rebalanceLow(): Promise<void> {
    // Low Balance: Wallet → Binance → Indodax → Xendit
    // Calculate top-up amount (e.g., fixed buffer above threshold)
    const threshold = rebalanceThreshold.xendit;
    const currentBalance = await this.getXenditBalance();
    const deficit = threshold - currentBalance;
    const topUpAmount = deficit

    // Calculate required BTC
    const ticker = await this.indodaxService.fetchTicker("usdt_idr");
    const usdToIdr = ticker.buy;
    const usdtNeeded = topUpAmount / usdToIdr;
    const btcToUsdtPrice =
      (await this.binanceService.getTokenToIdrPrice("BTC")) / usdToIdr;
    const btcNeeded = usdtNeeded / btcToUsdtPrice;

    // Send BTC from Wallet to Binance
    const deposit = await this.binanceClient.depositAddress("BTC");
    const binanceBtcAddress = deposit.address;

    const paidDeposits = [
      {
        btcAmount: btcNeeded,
        btcAddress: binanceBtcAddress,
      },
    ];
    const txId = await this.btcService.sendBTCBulkToUsers(paidDeposits);

    // Wait for confirmation (simplified; in production, use polling or webhooks)
    let confirmed = false;
    while (!confirmed) {
      confirmed = await this.btcService.isTransactionConfirmed(txId);
      await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait 1 minute
    }

    // Sell BTC for USDT on Binance
    await this.binanceService.sellTokenFromBinance("BTC", btcNeeded);

    // Send USDT from Binance to Indodax (assume USDT amount ≈ usdtNeeded, ignoring fees)
    const indodaxUsdtAddress = process.env.INDODAX_USDT_ADDRESS!;
    const indodaxUsdtMemo = process.env.INDODAX_USDT_MEMO || "";
    await this.binanceClient.withdraw(
      "USDT",
      usdtNeeded,
      indodaxUsdtAddress,
      indodaxUsdtMemo
    );

    // Sell USDT for IDR on Indodax
    const sellTicker = await this.indodaxService.fetchTicker("usdt_idr");
    const sellPrice = sellTicker.buy; // Sell at current buy price for immediate fill
    const sellParams = {
      pair: "usdt_idr",
      type: "sell",
      usdt: usdtNeeded,
      price: sellPrice,
    };
    await this.indodaxService.privateCall("trade", sellParams);

    // IDR is now in Indodax; manual withdrawal to Xendit funding account
    console.log(
      `Manual step required: Withdraw ${topUpAmount} IDR from Indodax to Xendit funding bank account.`
    );
    // In production, could trigger notification or integrate if API becomes available
  }

  private async rebalanceHigh(): Promise<void> {
    // High Balance: Xendit → Indodax → Binance → Wallet
    const threshold = rebalanceThreshold.xendit;
    const currentBalance = await this.getXenditBalance();
    const excess = currentBalance - threshold;
    if (excess <= 0) return;

    // Payout excess IDR from Xendit to Indodax deposit bank
    const payoutDto: PayoutDTO = {
      amount: excess,
      currency: "IDR",
      channelCode: process.env.INDODAX_BANK_CODE || "BCA",
      accountNumber: process.env.INDODAX_ACCOUNT_NUMBER!,
      accountHolderName: process.env.INDODAX_ACCOUNT_HOLDER!,
      description: "Rebalance excess from Xendit to Indodax",
      referenceId: `REB-HIGH-${Date.now()}`,
      idempotencyKey: `REB-HIGH-${Date.now()}`,
    };
    const payout = await this.xenditService.createPayout(payoutDto);

    // Wait for payout completion (simplified; use webhooks in production)
    let payoutStatus = await this.xenditService.getPayout(payout.id!);
    while (payoutStatus.status !== "SUCCEEDED") {
      await new Promise((resolve) => setTimeout(resolve, 60000));
      payoutStatus = await this.xenditService.getPayout(payout.id!);
    }

    // Buy USDT with IDR on Indodax
    const buyTicker = await this.indodaxService.fetchTicker("usdt_idr");
    const buyPrice = parseFloat(buyTicker.sell); // Buy at current sell price for immediate fill
    const buyParams = {
      pair: "usdt_idr",
      type: "buy",
      idr: excess,
      price: buyPrice,
    };
    const tradeResponse = await this.indodaxService.privateCall(
      "trade",
      buyParams
    );
    const usdtAmount = tradeResponse.return.receive_usdt || excess / buyPrice; // Adjust based on actual response

    // Withdraw USDT from Indodax to Binance
    const deposit = await this.binanceClient.depositAddress("USDT");
    const binanceUsdtAddress = deposit.address;
    const binanceUsdtTag = deposit.tag || "";
    const withdrawParams = {
      currency: "usdt",
      withdraw_address: binanceUsdtAddress,
      withdraw_amount: usdtAmount,
      request_id: `REB-HIGH-${Date.now()}`,
      withdraw_memo: binanceUsdtTag,
    };
    await this.indodaxService.privateCall("withdrawCoin", withdrawParams);

    // Buy BTC with USDT on Binance (using equivalent IDR value)
    const usdToIdr = parseFloat(buyTicker.sell);
    const idrValue = usdtAmount * usdToIdr;
    const { tokenAmount: btcAmount } =
      await this.binanceService.buyTokenFromBinance("BTC", idrValue);

    // Withdraw BTC from Binance to Wallet
    const walletAddress = this.btcService.devAddress;
    await this.binanceClient.withdraw("BTC", btcAmount, walletAddress);
  }
}
