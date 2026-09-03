CREATE TABLE "Thread" (
  "id" TEXT NOT NULL, "roomId" TEXT NOT NULL, "rootMessageId" TEXT NOT NULL,
  "createdByMemberId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "lastSequence" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ThreadReply" (
  "id" TEXT NOT NULL, "threadId" TEXT NOT NULL, "roomId" TEXT NOT NULL, "senderMemberId" TEXT NOT NULL,
  "body" TEXT NOT NULL, "clientId" TEXT, "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ThreadReply_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ThreadRead" (
  "threadId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ThreadRead_pkey" PRIMARY KEY ("threadId", "memberId")
);
CREATE UNIQUE INDEX "Thread_rootMessageId_key" ON "Thread"("rootMessageId");
CREATE INDEX "Thread_roomId_updatedAt_idx" ON "Thread"("roomId","updatedAt");
CREATE UNIQUE INDEX "ThreadReply_threadId_sequence_key" ON "ThreadReply"("threadId","sequence");
CREATE UNIQUE INDEX "ThreadReply_threadId_senderMemberId_clientId_key" ON "ThreadReply"("threadId","senderMemberId","clientId");
CREATE INDEX "ThreadReply_threadId_createdAt_idx" ON "ThreadReply"("threadId","createdAt");
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_rootMessageId_fkey" FOREIGN KEY ("rootMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "RoomMember"("id") ON UPDATE CASCADE;
ALTER TABLE "ThreadReply" ADD CONSTRAINT "ThreadReply_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreadReply" ADD CONSTRAINT "ThreadReply_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreadReply" ADD CONSTRAINT "ThreadReply_senderMemberId_fkey" FOREIGN KEY ("senderMemberId") REFERENCES "RoomMember"("id") ON UPDATE CASCADE;
ALTER TABLE "ThreadRead" ADD CONSTRAINT "ThreadRead_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreadRead" ADD CONSTRAINT "ThreadRead_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "RoomMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
