import { injectable, inject } from "tsyringe";
import { interval, from, Subscription } from "rxjs";
import { exhaustMap } from "rxjs/operators";
import { ActionService } from "../action/action.service";
import { TransactionService } from "../transaction-management/transaction-management.service";

@injectable()
export class TransactionProcessorService {
  private subscription: Subscription | null = null;

  constructor(
    @inject(ActionService) private actionService: ActionService,
    @inject(TransactionService) private transactionService: TransactionService
  ) {}

  /**
   * Start the background processor.
   * Returns the RxJS Subscription so caller can unsubscribe when shutting down.
   */
  start(intervalMs = 10000): Subscription {
    console.log(
      `🔁 Transaction Processor will run every ${intervalMs / 1000}s`
    );

    // If already started, return existing subscription
    if (this.subscription && !this.subscription.closed) {
      console.log("⚠️ Transaction Processor already running.");
      return this.subscription;
    }

    this.subscription = interval(intervalMs)
      .pipe(
        // exhaustMap ignores new ticks while the inner observable is running — prevents overlap
        exhaustMap(() => {
          console.log("▶️ Starting Transaction Processor...");
          return from(this.run());
        })
      )
      .subscribe({
        error: (err: any) =>
          console.error(
            "❌ Uncaught error in transaction processor stream:",
            err
          ),
      });

    return this.subscription;
  }

  /**
   * Stop the background processor if running
   */
  stop() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
      console.log("⏹ Transaction Processor stopped.");
    }
  }

  private async run(): Promise<void> {
    try {
      // 1) mark xendit deposits (checks Xendit and mark WAITING->PAID)
      console.log("🔍 Marking Xendit deposits (if any)...");
      try {
        // ActionService implements markPaidXenditDeposits
        // it's fine if it throws — we catch individually to keep pipeline robust
        await this.actionService.markPaidXenditDeposits();
      } catch (err) {
        console.error("❗ markPaidXenditDeposits failed:", err);
      }

      // 2) check on-chain bitcoin payments for withdrawals (and update statuses)
      console.log("🔍 Checking for Bitcoin payments...");
      try {
        await this.actionService.checkBitcoinPayments();
      } catch (err) {
        console.error("❗ checkBitcoinPayments failed:", err);
      }

      // 3) expire old transactions (transactionService handles expiry & deletion)
      console.log("🔍 Checking for expired transactions...");
      try {
        const res = await this.transactionService.expireOldTransactions();
        if (res) {
          console.log(
            `🔁 Expire/Delete results — expired: ${res.expired}, deleted: ${res.deleted}`
          );
        }
      } catch (err) {
        console.error("❗ expireOldTransactions failed:", err);
      }

      // 4) process paid transactions (buys/sells, payouts, bulk sends, finalize)
      console.log("🔍 Processing paid transactions...");
      try {
        await this.actionService.processPaidTransactions();
      } catch (err) {
        console.error("❗ processPaidTransactions failed:", err);
      }
    } catch (err) {
      // top-level safety - should rarely happen because each step has its own try/catch
      console.error("❌ Error in processor run:", err);
    } finally {
      console.log("✅ Transaction Processor finished this tick.");
    }
  }
}
