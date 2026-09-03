-- Supports current-room message search filters and chronological pagination.
CREATE INDEX "Message_roomId_kind_createdAt_idx" ON "Message"("roomId", "kind", "createdAt");
