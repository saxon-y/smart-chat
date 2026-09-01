-- AlterEnum
ALTER TYPE "AiRunStatus" ADD VALUE IF NOT EXISTS 'PREPARING';
ALTER TYPE "AiRunStatus" ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE "AiRunStatus" ADD VALUE IF NOT EXISTS 'WAITING_APPROVAL';
ALTER TYPE "AiRunStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "AiRunStatus" ADD VALUE IF NOT EXISTS 'RETRY_WAIT';
ALTER TYPE "AiRunStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';

-- AlterTable
ALTER TABLE "AiRun"
  ADD COLUMN "runtimeId" TEXT,
  ADD COLUMN "runtimeKind" TEXT,
  ADD COLUMN "runtimeVersion" TEXT,
  ADD COLUMN "taskDigest" TEXT,
  ADD COLUMN "contextGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "skillBundleHash" TEXT,
  ADD COLUMN "mcpBundleDigest" TEXT,
  ADD COLUMN "checkpointSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN "blockedReason" TEXT,
  ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "toolCallCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "costMicros" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AiRun_runtimeId_status_nextRetryAt_leaseExpiresAt_idx"
  ON "AiRun"("runtimeId", "status", "nextRetryAt", "leaseExpiresAt");
