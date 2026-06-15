/*
  Warnings:

  - You are about to drop the column `flavorId` on the `InventoryLine` table. All the data in the column will be lost.
  - You are about to drop the column `toppingId` on the `InventoryLine` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "InventoryLine" DROP CONSTRAINT "InventoryLine_flavorId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryLine" DROP CONSTRAINT "InventoryLine_toppingId_fkey";

-- AlterTable
ALTER TABLE "InventoryLine" DROP COLUMN "flavorId",
DROP COLUMN "toppingId",
ADD COLUMN     "label" TEXT,
ADD COLUMN     "productId" TEXT;

-- CreateTable
CREATE TABLE "InventoryEdit" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "InventoryEdit_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InventoryLine" ADD CONSTRAINT "InventoryLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEdit" ADD CONSTRAINT "InventoryEdit_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "InventorySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEdit" ADD CONSTRAINT "InventoryEdit_editedBy_fkey" FOREIGN KEY ("editedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
