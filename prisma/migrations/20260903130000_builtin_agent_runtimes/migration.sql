INSERT INTO "AgentRuntime" (
  "id", "kind", "capabilities", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('legacy', 'legacy', '{}'::jsonb, 'UNKNOWN', 'legacy-v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('embedded', 'embedded', '{}'::jsonb, 'UNKNOWN', 'embedded-v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('self_hosted', 'self_hosted', '{}'::jsonb, 'UNKNOWN', 'self_hosted-v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "kind" = EXCLUDED."kind",
  "version" = EXCLUDED."version",
  "updatedAt" = CURRENT_TIMESTAMP;
