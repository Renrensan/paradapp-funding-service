import { injectable, inject } from "tsyringe";
import { interval, from, Subscription } from "rxjs";
import { exhaustMap } from "rxjs/operators";
import { ActionService } from "../action/action.service";
import { TransactionService } from "../transaction-management/transaction-management.service";
import { Logger } from "../../common/logger";

@injectable()
export class TransactionProcessorService {
  private subscription: Subscription | null = null;
  private logger = new Logger("TransactionProcessor");

  constructor(
    @inject(ActionService) private actionService: ActionService,
    @inject(TransactionService) private transactionService: TransactionService
  ) {}

  /**
   * Start the background processor.
   * Returns the RxJS Subscription so caller can unsubscribe when shutting down.
   */
  start(intervalMs: number): Subscription {
    this.logger.info(`Processor will run every ${intervalMs / 1000}s`);

    if (this.subscription && !this.subscription.closed) {
      this.logger.warn("Processor already running, ignoring start()");
      return this.subscription;
    }

    this.subscription = interval(intervalMs)
      .pipe(
        exhaustMap(() => {
          this.logger.debug("Tick started → executing run()");
          return from(this.run());
        })
      )
      .subscribe({
        error: (err: any) =>
          this.logger.error("Uncaught error in processor stream", err),
      });

    this.logger.info(`Processor started (interval ${intervalMs}ms)`);
    return this.subscription;
  }

  stop() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
      this.logger.info("Processor stopped");
    }
  }

  private async run(): Promise<void> {
    this.logger.debug("Run cycle begin");

    try {
      // ===== 1) Mark Xendit Deposits =====
      this.logger.info("Checking Xendit deposits...");
      try {
        await this.actionService.markPaidXenditDeposits();
        this.logger.debug("markPaidXenditDeposits completed");
      } catch (err) {
        this.logger.error("markPaidXenditDeposits failed", err);
      }

      // ===== 2) BTC Payments =====
      this.logger.info("Checking Bitcoin payments...");
      try {
        await this.actionService.checkBitcoinPayments();
        this.logger.debug("checkBitcoinPayments completed");
      } catch (err) {
        this.logger.error("checkBitcoinPayments failed", err);
      }

      // ===== 3) HEDERA Payments =====
      this.logger.info("Checking Hedera payments...");
      try {
        await this.actionService.checkHbarPayments();
        this.logger.debug("checkHbarPayments completed");
      } catch (err) {
        this.logger.error("checkHbarPayments failed", err);
      }

      // ===== 3) Expire old transactions =====
      // this.logger.info("Checking expired transactions...");
      // try {
      //   const result = await this.transactionService.expireOldTransactions();
      //   if (result) {
      //     this.logger.debug(
      //       `Expired: ${result.expired}, Deleted: ${result.deleted}`
      //     );
      //   }
      // } catch (err) {
      //   this.logger.error("expireOldTransactions failed", err);
      // }

      // ===== 4) Process paid transactions =====
      this.logger.info("Processing paid transactions...");
      try {
        await this.actionService.processPaidTransactions();
        this.logger.debug("processPaidTransactions completed");
      } catch (err) {
        this.logger.error("processPaidTransactions failed", err);
      }
    } catch (err) {
      this.logger.error("Unexpected error in run()", err);
    } finally {
      this.logger.info("Tick finished");
    }
  }
}
