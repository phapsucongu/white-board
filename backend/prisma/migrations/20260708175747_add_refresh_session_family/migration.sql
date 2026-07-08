-- Add token-family tracking to RefreshSession for refresh-token reuse detection.
ALTER TABLE "RefreshSession" ADD COLUMN "familyId" TEXT;

CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");
