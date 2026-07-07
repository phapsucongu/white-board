-- AlterTable
ALTER TABLE "BoardEvent" ADD COLUMN "clientOpId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BoardEvent_roomId_clientOpId_key" ON "BoardEvent"("roomId", "clientOpId");
