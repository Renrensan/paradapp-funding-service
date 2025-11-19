import "reflect-metadata";
import { container } from "tsyringe";
import { ACTION_TOKENS } from "./tokens";
import { ActionService } from "./action.service";
import { XENDIT_TOKENS } from "../xendit/tokens";
import { TRANSACTION_TOKENS } from "../transaction-management/tokens";

export function registerActionModule() {
  container.register(ACTION_TOKENS.ActionService, {
    useClass: ActionService,
  });

  if (!container.isRegistered(XENDIT_TOKENS.XenditService)) {
    throw new Error(
      "XenditService is not registered. Register Xendit module first."
    );
  }

  if (!container.isRegistered(TRANSACTION_TOKENS.TRANSACTION_SERVICE)) {
    throw new Error(
      "TransactionService is not registered. Register Transaction module first."
    );
  }
}
