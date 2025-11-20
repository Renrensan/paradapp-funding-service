import { registerBTCModule } from "./btc/btc.module";
import { registerHederaModule } from "./hedera/hedera.module";

export function registerWalletManagementModule() {
  registerBTCModule();
  registerHederaModule();
}
