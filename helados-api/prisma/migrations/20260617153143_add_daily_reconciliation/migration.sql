-- CreateTable
CREATE TABLE "DailyReconciliation" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "actualCash" DECIMAL(10,2) NOT NULL,
    "actualQr" DECIMAL(10,2) NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyReconciliation_date_key" ON "DailyReconciliation"("date");
