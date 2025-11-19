import { TokenType } from "@prisma/client";

export interface IBinanceService {
    buyTokenFromBinance(
        token: TokenType,
        idrAmount: number
        ): Promise<{ cexTxId: string; tokenAmount: number }>

    sellTokenFromBinance(
        token: TokenType,
        tokenAmount: number
    ): Promise<{ cexTxId: string; idrAmount: number }>
}