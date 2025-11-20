import { registerActionModule } from "./modules/action/action.module";
import { registerBinanceModule } from "./modules/binance/binance.module";
import { registerIndodaxModule } from "./modules/indodax/indodax.module";
import { registerTransactionModule } from "./modules/transaction-management/transaction-management.module";
import { registerWalletManagementModule } from "./modules/wallet-management/wallet.module";
import { registerXenditModule } from "./modules/xendit/xendit.module";

export function registerDependencies(app: any) {
  registerXenditModule();
  registerTransactionModule(app);
  registerBinanceModule();
  registerIndodaxModule(
    process.env.INDODAX_API_KEY!,
    process.env.INDODAX_SECRET!
  );
  registerWalletManagementModule();
  registerActionModule();
}
