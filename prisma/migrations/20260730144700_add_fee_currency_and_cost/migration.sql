-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "feeCurrency" TEXT,
ADD COLUMN     "feeCost" DECIMAL(18,8);
