-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- Migrate existing orders: create one payment row per order
INSERT INTO "OrderPayment" ("id", "orderId", "paymentMethod", "amount")
SELECT gen_random_uuid(), "id", "paymentMethod", "totalAmount"
FROM "Order";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "paymentMethod";

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
