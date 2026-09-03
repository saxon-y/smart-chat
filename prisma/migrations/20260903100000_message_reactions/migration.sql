CREATE TABLE "MessageReaction" ("id" TEXT NOT NULL, "messageId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "emoji" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MessageReaction_messageId_memberId_emoji_key" ON "MessageReaction"("messageId", "memberId", "emoji");
CREATE INDEX "MessageReaction_messageId_emoji_idx" ON "MessageReaction"("messageId", "emoji");
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "RoomMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
