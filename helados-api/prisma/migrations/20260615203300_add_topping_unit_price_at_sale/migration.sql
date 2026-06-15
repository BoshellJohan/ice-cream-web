/*
  Warnings:

  - Added the required column `unitPriceAtSale` to the `OrderItemTopping` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OrderItemTopping" ADD COLUMN     "unitPriceAtSale" DECIMAL(10,2) NOT NULL;
