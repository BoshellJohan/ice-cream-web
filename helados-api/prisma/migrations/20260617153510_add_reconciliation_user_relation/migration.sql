-- AddForeignKey
ALTER TABLE "DailyReconciliation" ADD CONSTRAINT "DailyReconciliation_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
