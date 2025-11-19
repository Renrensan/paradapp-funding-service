import { registerBTCModule } from "./btc/btc.module";

export function registerWalletManagementModule() {
  registerBTCModule();
}
