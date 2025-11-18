import { TokenType } from "@prisma/client";

export function roundToBinanceStep(amount: number, token: TokenType): number {
  const step = token === TokenType.HBAR ? 1 : 0.00001;
  const minQty = token === TokenType.HBAR ? 1 : 0.00005;

  const rounded = Math.floor(amount / step) * step;

  if (rounded < minQty) {
    throw new Error(`Quantity ${rounded} is below Binance minimum LOT_SIZE of ${minQty}`);
  }

  return Number(rounded.toFixed(6));
}
