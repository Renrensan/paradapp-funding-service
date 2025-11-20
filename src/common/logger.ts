// src/common/logger.ts
import pino from "pino";

// Detect environment
const isDev = process.env.NODE_ENV !== "production";

const baseLogger = pino(
  isDev
    ? {
        // Pretty logs only in development
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "yyyy-mm-dd HH:MM:ss.l o",
            ignore: "pid,hostname",
          },
        },
        level: process.env.LOG_LEVEL || "debug",
      }
    : {
        // Clean, structured JSON logs in production (perfect for logs ingestion)
        level: process.env.LOG_LEVEL || "info",
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
);

export class Logger {
  constructor(private context: string) {}

  private format(msg: string): string {
    return `[${this.context}] ${msg}`;
  }

  info(msg: string, ...meta: any[]) {
    baseLogger.info(this.format(msg), ...meta);
  }
  warn(msg: string, ...meta: any[]) {
    baseLogger.warn(this.format(msg), ...meta);
  }
  error(msg: string, ...meta: any[]) {
    baseLogger.error(this.format(msg), ...meta);
  }
  debug(msg: string, ...meta: any[]) {
    baseLogger.debug(this.format(msg), ...meta);
  }
}

export class TxLogger {
  constructor(private txId: string) {}

  private format(msg: string): string {
    return `[TX:${this.txId}] ${msg}`;
  }

  info(msg: string, ...meta: any[]) {
    baseLogger.info(this.format(msg), ...meta);
  }
  warn(msg: string, ...meta: any[]) {
    baseLogger.warn(this.format(msg), ...meta);
  }
  error(msg: string, ...meta: any[]) {
    baseLogger.error(this.format(msg), ...meta);
  }
  debug(msg: string, ...meta: any[]) {
    baseLogger.debug(this.format(msg), ...meta);
  }
}

export const logger = baseLogger;