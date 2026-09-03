CREATE TABLE "MessagePin" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "pinnedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "MessagePin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageBookmark" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "MessageBookmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagePin_roomId_messageId_key" ON "MessagePin"("roomId", "messageId");
CREATE INDEX "MessagePin_roomId_deletedAt_createdAt_idx" ON "MessagePin"("roomId", "deletedAt", "createdAt");
CREATE UNIQUE INDEX "MessageBookmark_roomId_messageId_memberId_key" ON "MessageBookmark"("roomId", "messageId", "memberId");
CREATE INDEX "MessageBookmark_memberId_deletedAt_createdAt_idx" ON "MessageBookmark"("memberId", "deletedAt", "createdAt");

ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageBookmark" ADD CONSTRAINT "MessageBookmark_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageBookmark" ADD CONSTRAINT "MessageBookmark_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageBookmark" ADD CONSTRAINT "MessageBookmark_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "RoomMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
