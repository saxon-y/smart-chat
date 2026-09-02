-- Backfill runtime identities that may have been written while runtimeId was metadata-only.
CREATE TABLE "AgentRuntime" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "endpoint" TEXT,
    "capabilities" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentRuntime_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AgentRuntime" (
    "id", "kind", "capabilities", "status", "createdAt", "updatedAt"
)
SELECT DISTINCT
    "runtimeId", COALESCE("runtimeKind", 'legacy'), '{}'::jsonb, 'UNKNOWN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "AiRun"
WHERE "runtimeId" IS NOT NULL;

CREATE TABLE "AgentRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRunEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentRunTurn" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "prefixDigest" TEXT NOT NULL,
    "loadedSkillIds" JSONB NOT NULL,
    "loadedToolSchemaIds" JSONB NOT NULL,
    "providerRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "assistantContent" JSONB,
    "thinking" JSONB,
    "thinkingContinuity" TEXT NOT NULL DEFAULT 'NONE',
    "finishReason" TEXT,
    "usage" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "AgentRunTurn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentRunCheckpoint" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "eventSequence" INTEGER NOT NULL,
    "runtimeSessionId" TEXT,
    "taskDigest" TEXT NOT NULL,
    "contextGeneration" INTEGER NOT NULL,
    "skillBundleHash" TEXT NOT NULL,
    "mcpBundleDigest" TEXT NOT NULL,
    "loadedSkillIds" JSONB NOT NULL,
    "loadedToolSchemaIds" JSONB NOT NULL,
    "inboundSequence" INTEGER NOT NULL DEFAULT 0,
    "cumulativeUsage" JSONB NOT NULL,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRunCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "toolId" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "argumentsDigest" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "concurrency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "result" JSONB,
    "resultOrigin" TEXT,
    "resultArtifactId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "argumentsDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionReason" TEXT,
    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SkillRevision" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "McpConfigRevision" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "approvedTools" JSONB NOT NULL,
    "schemaDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpConfigRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentRuntime_status_lastHeartbeatAt_idx" ON "AgentRuntime"("status", "lastHeartbeatAt");
CREATE INDEX "AgentRuntime_kind_status_idx" ON "AgentRuntime"("kind", "status");
CREATE UNIQUE INDEX "AgentRunEvent_runId_sequence_key" ON "AgentRunEvent"("runId", "sequence");
CREATE INDEX "AgentRunEvent_runId_createdAt_idx" ON "AgentRunEvent"("runId", "createdAt");
CREATE INDEX "AgentRunEvent_type_createdAt_idx" ON "AgentRunEvent"("type", "createdAt");
CREATE UNIQUE INDEX "AgentRunTurn_runId_turnIndex_key" ON "AgentRunTurn"("runId", "turnIndex");
CREATE INDEX "AgentRunTurn_runId_status_startedAt_idx" ON "AgentRunTurn"("runId", "status", "startedAt");
CREATE INDEX "AgentRunTurn_providerRequestId_idx" ON "AgentRunTurn"("providerRequestId");
CREATE UNIQUE INDEX "AgentRunCheckpoint_runId_eventSequence_key" ON "AgentRunCheckpoint"("runId", "eventSequence");
CREATE INDEX "AgentRunCheckpoint_runId_turnIndex_idx" ON "AgentRunCheckpoint"("runId", "turnIndex");
CREATE INDEX "AgentRunCheckpoint_runtimeSessionId_idx" ON "AgentRunCheckpoint"("runtimeSessionId");
CREATE UNIQUE INDEX "AgentToolCall_idempotencyKey_key" ON "AgentToolCall"("idempotencyKey");
CREATE UNIQUE INDEX "AgentToolCall_runId_id_key" ON "AgentToolCall"("runId", "id");
CREATE INDEX "AgentToolCall_runId_turnIndex_idx" ON "AgentToolCall"("runId", "turnIndex");
CREATE INDEX "AgentToolCall_runId_status_createdAt_idx" ON "AgentToolCall"("runId", "status", "createdAt");
CREATE UNIQUE INDEX "AgentApproval_runId_toolCallId_argumentsDigest_key" ON "AgentApproval"("runId", "toolCallId", "argumentsDigest");
CREATE INDEX "AgentApproval_status_requestedAt_idx" ON "AgentApproval"("status", "requestedAt");
CREATE INDEX "AgentApproval_runId_status_idx" ON "AgentApproval"("runId", "status");
CREATE UNIQUE INDEX "SkillRevision_bundleHash_key" ON "SkillRevision"("bundleHash");
CREATE UNIQUE INDEX "SkillRevision_skillId_version_key" ON "SkillRevision"("skillId", "version");
CREATE INDEX "SkillRevision_skillId_createdAt_idx" ON "SkillRevision"("skillId", "createdAt");
CREATE UNIQUE INDEX "McpConfigRevision_configId_revision_key" ON "McpConfigRevision"("configId", "revision");
CREATE INDEX "McpConfigRevision_configId_createdAt_idx" ON "McpConfigRevision"("configId", "createdAt");
CREATE INDEX "McpConfigRevision_schemaDigest_idx" ON "McpConfigRevision"("schemaDigest");

ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_runtimeId_fkey" FOREIGN KEY ("runtimeId") REFERENCES "AgentRuntime"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentRunTurn" ADD CONSTRAINT "AgentRunTurn_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentRunCheckpoint" ADD CONSTRAINT "AgentRunCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentRunCheckpoint" ADD CONSTRAINT "AgentRunCheckpoint_runId_turnIndex_fkey" FOREIGN KEY ("runId", "turnIndex") REFERENCES "AgentRunTurn"("runId", "turnIndex") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentRunCheckpoint" ADD CONSTRAINT "AgentRunCheckpoint_runId_eventSequence_fkey" FOREIGN KEY ("runId", "eventSequence") REFERENCES "AgentRunEvent"("runId", "sequence") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_turnIndex_fkey" FOREIGN KEY ("runId", "turnIndex") REFERENCES "AgentRunTurn"("runId", "turnIndex") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_resultArtifactId_fkey" FOREIGN KEY ("resultArtifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_runId_toolCallId_fkey" FOREIGN KEY ("runId", "toolCallId") REFERENCES "AgentToolCall"("runId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SkillRevision" ADD CONSTRAINT "SkillRevision_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_agent_revision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SkillRevision_immutable"
BEFORE UPDATE OR DELETE ON "SkillRevision"
FOR EACH ROW EXECUTE FUNCTION prevent_agent_revision_mutation();

CREATE TRIGGER "McpConfigRevision_immutable"
BEFORE UPDATE OR DELETE ON "McpConfigRevision"
FOR EACH ROW EXECUTE FUNCTION prevent_agent_revision_mutation();
