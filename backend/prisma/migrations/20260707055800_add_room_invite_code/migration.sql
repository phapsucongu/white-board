-- AlterTable
ALTER TABLE "Room" ADD COLUMN "inviteCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Room_inviteCode_key" ON "Room"("inviteCode");
