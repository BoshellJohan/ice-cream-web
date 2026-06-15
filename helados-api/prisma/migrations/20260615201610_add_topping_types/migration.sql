-- CreateEnum
CREATE TYPE "ToppingType" AS ENUM ('NORMAL', 'PREMIUM');

-- AlterTable
ALTER TABLE "Topping" ADD COLUMN     "customPrice" DECIMAL(10,2),
ADD COLUMN     "type" "ToppingType" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "ToppingTypeConfig" (
    "type" "ToppingType" NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ToppingTypeConfig_pkey" PRIMARY KEY ("type")
);
