import { container } from "tsyringe";
import { TransactionProcessorService } from "./transaction-processor.service";
import { XenditResponsiveService } from "./xendit-processor.service";

export class TransactionProcessorModule {
  private static initialized = false;

  private static transactionProcessor: TransactionProcessorService | null =
    null;
  private static xenditResponsive: XenditResponsiveService | null = null;

  static init(transactionIntervalMs = 10000, xenditIntervalMs = 10000) {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    // Resolve services
    this.transactionProcessor = container.resolve(TransactionProcessorService);
    this.xenditResponsive = container.resolve(XenditResponsiveService);

    // Start services
    this.transactionProcessor.start(transactionIntervalMs);
    this.xenditResponsive.start(xenditIntervalMs);
  }

  static stop() {
    if (!this.initialized) return;

    if (this.transactionProcessor) this.transactionProcessor.stop();
    if (this.xenditResponsive) this.xenditResponsive.stop();

    this.transactionProcessor = null;
    this.xenditResponsive = null;
    this.initialized = false;
  }
}
