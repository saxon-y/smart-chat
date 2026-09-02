-- Idempotent upgrade for databases that predate the runtime record tables.
CREATE TABLE IF NOT EXISTS "AgentRuntime" (
  "id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL, "endpoint" TEXT,
  "capabilities" JSONB NOT NULL, "status" TEXT NOT NULL, "version" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

INSERT INTO "AgentRuntime" ("id", "kind", "capabilities", "status", "createdAt", "updatedAt")
SELECT DISTINCT "runtimeId", COALESCE("runtimeKind", 'legacy'), '{}'::jsonb, 'UNKNOWN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "AiRun" WHERE "runtimeId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "AgentRunEvent" (
  "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "AgentRunTurn" (
  "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "turnIndex" INTEGER NOT NULL,
  "inputDigest" TEXT NOT NULL, "prefixDigest" TEXT NOT NULL, "loadedSkillIds" JSONB NOT NULL,
  "loadedToolSchemaIds" JSONB NOT NULL, "providerRequestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'STARTED', "assistantContent" JSONB, "thinking" JSONB,
  "thinkingContinuity" TEXT NOT NULL DEFAULT 'NONE', "finishReason" TEXT, "usage" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS "AgentRunCheckpoint" (
  "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "turnIndex" INTEGER NOT NULL,
  "eventSequence" INTEGER NOT NULL, "runtimeSessionId" TEXT, "taskDigest" TEXT NOT NULL,
  "contextGeneration" INTEGER NOT NULL, "skillBundleHash" TEXT NOT NULL, "mcpBundleDigest" TEXT NOT NULL,
  "loadedSkillIds" JSONB NOT NULL, "loadedToolSchemaIds" JSONB NOT NULL,
  "inboundSequence" INTEGER NOT NULL DEFAULT 0, "cumulativeUsage" JSONB NOT NULL,
  "summary" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "AgentToolCall" (
  "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "turnIndex" INTEGER NOT NULL,
  "toolId" TEXT NOT NULL, "toolVersion" TEXT NOT NULL, "arguments" JSONB NOT NULL,
  "argumentsDigest" TEXT NOT NULL, "risk" TEXT NOT NULL, "concurrency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "idempotencyKey" TEXT, "result" JSONB,
  "resultOrigin" TEXT, "resultArtifactId" TEXT, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "AgentApproval" (
  "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "toolCallId" TEXT NOT NULL,
  "argumentsDigest" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "decidedAt" TIMESTAMP(3),
  "decidedBy" TEXT, "decisionReason" TEXT
);
CREATE TABLE IF NOT EXISTS "SkillRevision" (
  "id" TEXT PRIMARY KEY, "skillId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "bundleHash" TEXT NOT NULL, "manifest" JSONB NOT NULL, "content" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "McpConfigRevision" (
  "id" TEXT PRIMARY KEY, "configId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "config" JSONB NOT NULL, "approvedTools" JSONB NOT NULL, "schemaDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AgentRuntime_status_lastHeartbeatAt_idx" ON "AgentRuntime"("status", "lastHeartbeatAt");
CREATE INDEX IF NOT EXISTS "AgentRuntime_kind_status_idx" ON "AgentRuntime"("kind", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunEvent_runId_sequence_key" ON "AgentRunEvent"("runId", "sequence");
CREATE INDEX IF NOT EXISTS "AgentRunEvent_runId_createdAt_idx" ON "AgentRunEvent"("runId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentRunEvent_type_createdAt_idx" ON "AgentRunEvent"("type", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunTurn_runId_turnIndex_key" ON "AgentRunTurn"("runId", "turnIndex");
CREATE INDEX IF NOT EXISTS "AgentRunTurn_runId_status_startedAt_idx" ON "AgentRunTurn"("runId", "status", "startedAt");
CREATE INDEX IF NOT EXISTS "AgentRunTurn_providerRequestId_idx" ON "AgentRunTurn"("providerRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunCheckpoint_runId_eventSequence_key" ON "AgentRunCheckpoint"("runId", "eventSequence");
CREATE INDEX IF NOT EXISTS "AgentRunCheckpoint_runId_turnIndex_idx" ON "AgentRunCheckpoint"("runId", "turnIndex");
CREATE INDEX IF NOT EXISTS "AgentRunCheckpoint_runtimeSessionId_idx" ON "AgentRunCheckpoint"("runtimeSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentToolCall_idempotencyKey_key" ON "AgentToolCall"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentToolCall_runId_id_key" ON "AgentToolCall"("runId", "id");
CREATE INDEX IF NOT EXISTS "AgentToolCall_runId_turnIndex_idx" ON "AgentToolCall"("runId", "turnIndex");
CREATE INDEX IF NOT EXISTS "AgentToolCall_runId_status_createdAt_idx" ON "AgentToolCall"("runId", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentApproval_runId_toolCallId_argumentsDigest_key" ON "AgentApproval"("runId", "toolCallId", "argumentsDigest");
CREATE INDEX IF NOT EXISTS "AgentApproval_status_requestedAt_idx" ON "AgentApproval"("status", "requestedAt");
CREATE INDEX IF NOT EXISTS "AgentApproval_runId_status_idx" ON "AgentApproval"("runId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "SkillRevision_bundleHash_key" ON "SkillRevision"("bundleHash");
CREATE UNIQUE INDEX IF NOT EXISTS "SkillRevision_skillId_version_key" ON "SkillRevision"("skillId", "version");
CREATE INDEX IF NOT EXISTS "SkillRevision_skillId_createdAt_idx" ON "SkillRevision"("skillId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "McpConfigRevision_configId_revision_key" ON "McpConfigRevision"("configId", "revision");
CREATE INDEX IF NOT EXISTS "McpConfigRevision_configId_createdAt_idx" ON "McpConfigRevision"("configId", "createdAt");
CREATE INDEX IF NOT EXISTS "McpConfigRevision_schemaDigest_idx" ON "McpConfigRevision"("schemaDigest");

DO $$ BEGIN
  ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_runtimeId_fkey" FOREIGN KEY ("runtimeId") REFERENCES "AgentRuntime"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentRunTurn" ADD CONSTRAINT "AgentRunTurn_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentRunCheckpoint" ADD CONSTRAINT "AgentRunCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentRunCheckpoint" ADD CONSTRAINT "AgentRunCheckpoint_runId_turnIndex_fkey" FOREIGN KEY ("runId", "turnIndex") REFERENCES "AgentRunTurn"("runId", "turnIndex") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentRunCheckpoint" ADD CONSTRAINT "AgentRunCheckpoint_runId_eventSequence_fkey" FOREIGN KEY ("runId", "eventSequence") REFERENCES "AgentRunEvent"("runId", "sequence") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_turnIndex_fkey" FOREIGN KEY ("runId", "turnIndex") REFERENCES "AgentRunTurn"("runId", "turnIndex") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_resultArtifactId_fkey" FOREIGN KEY ("resultArtifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_runId_toolCallId_fkey" FOREIGN KEY ("runId", "toolCallId") REFERENCES "AgentToolCall"("runId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SkillRevision" ADD CONSTRAINT "SkillRevision_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION prevent_agent_revision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "SkillRevision_immutable" ON "SkillRevision";
CREATE TRIGGER "SkillRevision_immutable" BEFORE UPDATE OR DELETE ON "SkillRevision"
FOR EACH ROW EXECUTE FUNCTION prevent_agent_revision_mutation();
DROP TRIGGER IF EXISTS "McpConfigRevision_immutable" ON "McpConfigRevision";
CREATE TRIGGER "McpConfigRevision_immutable" BEFORE UPDATE OR DELETE ON "McpConfigRevision"
FOR EACH ROW EXECUTE FUNCTION prevent_agent_revision_mutation();
