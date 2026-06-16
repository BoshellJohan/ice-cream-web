-- Wipe all non-user data (dependency order: leaves first)
DELETE FROM "OrderItemTopping";
DELETE FROM "OrderItem";
DELETE FROM "OrderPayment";
DELETE FROM "Order";
DELETE FROM "InventoryEdit";
DELETE FROM "InventoryLine";
DELETE FROM "InventorySnapshot";
DELETE FROM "Topping";
DELETE FROM "Flavor";
DELETE FROM "Product";

-- Swap ProductType enum (PostgreSQL cannot drop enum values — must recreate)
ALTER TYPE "ProductType" RENAME TO "ProductType_old";
CREATE TYPE "ProductType" AS ENUM ('CONE', 'CONTAINER', 'BEVERAGE');
ALTER TABLE "Product" ALTER COLUMN "type" TYPE "ProductType" USING "type"::text::"ProductType";
DROP TYPE "ProductType_old";

-- Add new ProductSize values (adding is safe without data wipe)
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ4';
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ5';
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ6';
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ7';
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ8';

-- Make Product.size nullable
ALTER TABLE "Product" ALTER COLUMN "size" DROP NOT NULL;

-- Add productType and productSize to InventoryLine
ALTER TABLE "InventoryLine" ADD COLUMN "productType" "ProductType";
ALTER TABLE "InventoryLine" ADD COLUMN "productSize" "ProductSize";
