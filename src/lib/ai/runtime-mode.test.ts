import { describe, expect, it } from "vitest";
import { configuredRuntimeSnapshot, parseAgentRuntimeMode } from "./runtime-mode";

describe("agent runtime mode", () => {
  it("defaults to legacy while the migration is in progress", () => {
    expect(parseAgentRuntimeMode(undefined)).toBe("legacy");
    expect(parseAgentRuntimeMode("  ")).toBe("legacy");
  });

  it.each(["legacy", "embedded", "self_hosted"] as const)("accepts %s", (mode) => {
    expect(parseAgentRuntimeMode(mode)).toBe(mode);
  });

  it("rejects unknown values instead of silently selecting a runtime", () => {
    expect(() => parseAgentRuntimeMode("auto")).toThrow("invalid_agent_runtime_mode:auto");
  });

  it("freezes a stable runtime identity for persistence on the run", () => {
    expect(configuredRuntimeSnapshot("self_hosted")).toEqual({
      runtimeId: "self_hosted",
      runtimeKind: "self_hosted",
      runtimeVersion: "self_hosted-v1",
    });
  });
});
