-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('BTC', 'HBAR');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('WAITING', 'PENDING', 'PAID', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'WAITING',
    "tokenAmount" DOUBLE PRECISION,
    "tokenType" "TokenType" NOT NULL,
    "idrAmount" INTEGER,
    "walletAddress" TEXT NOT NULL,
    "paymentDetails" JSONB,
    "txHash" TEXT,
    "cexTxId" TEXT,
    "refAddress" TEXT,
    "refAmount" DOUBLE PRECISION,
    "xenditTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_cexTxId_key" ON "Transaction"("cexTxId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_xenditTxId_key" ON "Transaction"("xenditTxId");
