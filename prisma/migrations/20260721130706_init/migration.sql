-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'OPEN', 'FILLED', 'CANCELED', 'REJECTED');

-- CreateTable
CREATE TABLE "GridLevel" (
    "levelIndex" INTEGER NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "isHolding" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GridLevel_pkey" PRIMARY KEY ("levelIndex")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "fee" DECIMAL(18,8),
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "gridLevelId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_exchangeId_key" ON "Order"("exchangeId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_gridLevelId_fkey" FOREIGN KEY ("gridLevelId") REFERENCES "GridLevel"("levelIndex") ON DELETE RESTRICT ON UPDATE CASCADE;
