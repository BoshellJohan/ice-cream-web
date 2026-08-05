-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM ('REGISTRO_ERRONEO', 'CLIENTE_CANCELO', 'PRODUCTO_DEFECTUOSO', 'OTRO');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelReason" "CancelReason",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

