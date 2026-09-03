ALTER TABLE "Artifact" ADD COLUMN "roomId" TEXT;
ALTER TABLE "Artifact" ADD COLUMN "uploadedByMemberId" TEXT;
CREATE INDEX "Artifact_roomId_createdAt_idx" ON "Artifact"("roomId", "createdAt");
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_uploadedByMemberId_fkey" FOREIGN KEY ("uploadedByMemberId") REFERENCES "RoomMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
