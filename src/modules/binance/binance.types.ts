import { TokenType } from "@prisma/client";

export interface IBinanceService {
    buyTokenFromBinance(
        token: TokenType,
        idrAmount: number
        ): Promise<{ cexTxId: string; tokenAmount: number }>
}