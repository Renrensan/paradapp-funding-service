import { container } from "tsyringe";
import { TransactionProcessorService } from "./transaction-processor.service";

export class TransactionProcessorModule {
  private static initialized = false;

  static init(intervalMs = 10000) {
    if (this.initialized) {
      console.log(
        "⚠️ TransactionProcessorModule.init() called more than once. Ignoring."
      );
      return;
    }

    this.initialized = true;

    // Resolve service from DI container
    const processor = container.resolve(TransactionProcessorService);

    // Start background worker
    processor.start(intervalMs);

    console.log(
      `🚀 TransactionProcessorModule initialized (interval: ${intervalMs}ms)`
    );
  }

  static stop() {
    if (!this.initialized) return;

    const processor = container.resolve(TransactionProcessorService);
    processor.stop();

    console.log("🛑 TransactionProcessorModule stopped.");
  }
}
