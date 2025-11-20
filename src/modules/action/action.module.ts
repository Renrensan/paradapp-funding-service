import "reflect-metadata";
import { container } from "tsyringe";
import { ACTION_TOKENS } from "./tokens";
import { ActionService } from "./action.service";
import { Logger, TxLogger } from "../../common/logger"; // adjust path
import { XENDIT_TOKENS } from "../xendit/tokens";
import { TRANSACTION_TOKENS } from "../transaction-management/tokens";

export const LOGGER_TOKENS = {
  LoggerFactory: Symbol("LoggerFactory"),
  TxLoggerFactory: Symbol("TxLoggerFactory"),
};

export function registerActionModule() {
  // register the action service
  container.register(ACTION_TOKENS.ActionService, {
    useClass: ActionService,
  });

  // safety checks
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

  // Register logger factory (singleton)
  container.register(LOGGER_TOKENS.LoggerFactory, {
    useValue: (context: string) => new Logger(context),
  });

  // Register transaction logger factory
  container.register(LOGGER_TOKENS.TxLoggerFactory, {
    useValue: (txId: string) => new TxLogger(txId),
  });
}
