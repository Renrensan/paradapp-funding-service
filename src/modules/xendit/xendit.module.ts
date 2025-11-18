import { container } from "tsyringe";
import { XenditService } from "./xendit.service";
import { Xendit, Balance as BalanceClient, Payout as PayoutClient } from "xendit-node";
import { XENDIT_TOKENS } from "./tokens";

const xenditClient = new Xendit({ secretKey: process.env.XENDIT_SECRET_KEY! });

// Clients
const paymentRequestClient = xenditClient.PaymentRequest;
const balanceClient = xenditClient.Balance || new BalanceClient({ secretKey: process.env.XENDIT_SECRET_KEY! });
const payoutClient = xenditClient.Payout || new PayoutClient({ secretKey: process.env.XENDIT_SECRET_KEY! });

export function registerXenditModule() {
  container.registerInstance(XENDIT_TOKENS.PaymentRequestClient, paymentRequestClient);
  container.registerInstance(XENDIT_TOKENS.BalanceClient, balanceClient);
  container.registerInstance(XENDIT_TOKENS.PayoutClient, payoutClient);
  container.registerSingleton(XENDIT_TOKENS.XenditService, XenditService);
}
