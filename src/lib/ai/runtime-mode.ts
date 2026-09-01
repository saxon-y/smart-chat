export const AGENT_RUNTIME_MODES = ["legacy", "embedded", "self_hosted"] as const;

export type AgentRuntimeMode = (typeof AGENT_RUNTIME_MODES)[number];

export function parseAgentRuntimeMode(value = process.env.AGENT_RUNTIME_MODE): AgentRuntimeMode {
  const mode = value?.trim() || "legacy";
  if ((AGENT_RUNTIME_MODES as readonly string[]).includes(mode)) return mode as AgentRuntimeMode;
  throw new Error(`invalid_agent_runtime_mode:${mode}`);
}

export function configuredRuntimeSnapshot(value = process.env.AGENT_RUNTIME_MODE) {
  const mode = parseAgentRuntimeMode(value);
  return {
    runtimeId: mode,
    runtimeKind: mode,
    runtimeVersion: `${mode}-v1`,
  } as const;
}
