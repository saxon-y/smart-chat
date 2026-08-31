-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('SUPERVISOR', 'CHAT', 'IMAGE');

-- CreateEnum
CREATE TYPE "ModelProviderType" AS ENUM ('OPENAI_COMPATIBLE', 'OPENAI_IMAGES', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AiRunMode" AS ENUM ('DIRECT', 'SUPERVISOR', 'DELEGATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiRunStatus" ADD VALUE 'CLAIMED';
ALTER TYPE "AiRunStatus" ADD VALUE 'NO_ACTION';
ALTER TYPE "AiRunStatus" ADD VALUE 'CANCELLED';

-- DropIndex
DROP INDEX "AiRun_triggerMessageId_key";

-- DropIndex
DROP INDEX "RoomMember_roomId_assistantKey_key";

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "kind" "AgentKind" NOT NULL DEFAULT 'CHAT';

-- AlterTable
ALTER TABLE "AiRun" ADD COLUMN     "configVersion" INTEGER,
ADD COLUMN     "decision" TEXT,
ADD COLUMN     "decisionConfidence" DOUBLE PRECISION,
ADD COLUMN     "decisionReasonCode" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "membershipVersion" INTEGER,
ADD COLUMN     "mode" "AiRunMode" NOT NULL DEFAULT 'DIRECT',
ADD COLUMN     "parentRunId" TEXT,
ADD COLUMN     "roomId" TEXT,
ADD COLUMN     "targetAgentId" TEXT,
ADD COLUMN     "targetMemberId" TEXT;

UPDATE "AiRun" AS run
SET "roomId" = message."roomId"
FROM "Message" AS message
WHERE message."id" = run."triggerMessageId";

UPDATE "AiRun" AS run
SET "targetMemberId" = mention."memberId",
    "targetAgentId" = agent."id",
    "membershipVersion" = member."version"
FROM "MessageMention" AS mention
JOIN "RoomMember" AS member ON member."id" = mention."memberId"
JOIN "Agent" AS agent ON agent."key" = member."assistantKey"
WHERE mention."messageId" = run."triggerMessageId"
  AND run."targetMemberId" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AiRun" WHERE "roomId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill AiRun.roomId';
  END IF;
END $$;

ALTER TABLE "AiRun" ALTER COLUMN "roomId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Model" ADD COLUMN     "providerType" "ModelProviderType" NOT NULL DEFAULT 'OPENAI_COMPATIBLE';

-- CreateTable
CREATE TABLE "RoomSupervisor" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomSupervisor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "byteSize" INTEGER,
    "sha256" TEXT,
    "providerMetadata" JSONB,
    "moderationStatus" TEXT,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "runId" TEXT,
    "messageId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomSupervisor_roomId_key" ON "RoomSupervisor"("roomId");

-- CreateIndex
CREATE INDEX "RoomSupervisor_agentId_enabled_idx" ON "RoomSupervisor"("agentId", "enabled");

-- CreateIndex
CREATE INDEX "Artifact_runId_createdAt_idx" ON "Artifact"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_expiresAt_deletedAt_idx" ON "Artifact"("expiresAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_objectKey_key" ON "Artifact"("objectKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_roomId_createdAt_idx" ON "OutboxEvent"("roomId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiRun_idempotencyKey_key" ON "AiRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiRun_roomId_status_nextRetryAt_leaseExpiresAt_idx" ON "AiRun"("roomId", "status", "nextRetryAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AiRun_targetMemberId_status_idx" ON "AiRun"("targetMemberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiRun_triggerMessageId_mode_key" ON "AiRun"("triggerMessageId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "AiRun_parentRunId_targetMemberId_key" ON "AiRun"("parentRunId", "targetMemberId");

-- CreateIndex
CREATE INDEX "RoomMember_roomId_assistantKey_leftAt_idx" ON "RoomMember"("roomId", "assistantKey", "leftAt");

CREATE UNIQUE INDEX "RoomMember_active_assistant_unique"
ON "RoomMember"("roomId", "assistantKey")
WHERE "assistantKey" IS NOT NULL AND "leftAt" IS NULL;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "AiRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_targetAgentId_fkey" FOREIGN KEY ("targetAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_targetMemberId_fkey" FOREIGN KEY ("targetMemberId") REFERENCES "RoomMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomSupervisor" ADD CONSTRAINT "RoomSupervisor_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomSupervisor" ADD CONSTRAINT "RoomSupervisor_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
