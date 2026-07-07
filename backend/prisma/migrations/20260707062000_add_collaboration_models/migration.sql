-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "objectId" TEXT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "body" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextDocument" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "ydocBase64" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TextDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comment_roomId_idx" ON "Comment"("roomId");

-- CreateIndex
CREATE INDEX "Comment_objectId_idx" ON "Comment"("objectId");

-- CreateIndex
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "TextDocument_objectId_key" ON "TextDocument"("objectId");

-- CreateIndex
CREATE INDEX "TextDocument_roomId_idx" ON "TextDocument"("roomId");

-- CreateIndex
CREATE INDEX "TextDocument_updatedBy_idx" ON "TextDocument"("updatedBy");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextDocument" ADD CONSTRAINT "TextDocument_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextDocument" ADD CONSTRAINT "TextDocument_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
