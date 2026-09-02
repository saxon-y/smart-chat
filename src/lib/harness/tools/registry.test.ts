import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry, ToolRegistryError } from "./registry";

function definition(overrides: Record<string, unknown> = {}) {
  return {
    id: "room.read",
    version: "1.0.0",
    description: "Read a room",
    category: "perception" as const,
    inputSchema: z.strictObject({ roomId: z.string() }),
    inputSchemaDocument: { type: "object", properties: { roomId: { type: "string" } }, required: ["roomId"], additionalProperties: false },
    risk: "READ" as const,
    idempotency: "READ_ONLY" as const,
    timeoutMs: 100,
    maxResultBytes: 128,
    execute: vi.fn(async (input: { roomId: string }) => ({ id: input.roomId })),
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  it("pins stable identity, version, schema digest, and defaults to serial execution", () => {
    const registry = new ToolRegistry();
    const tool = registry.register(definition());
    expect(tool.schemaDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(tool.concurrency).toBe("forbidden");
    expect(registry.resolve(tool.id, tool.version, tool.schemaDigest)).toBe(tool);
    expect(() => registry.resolve(tool.id, "2.0.0")).toThrowError(new ToolRegistryError("tool_version_mismatch"));
    expect(() => registry.resolve("unknown", "1.0.0")).toThrowError(new ToolRegistryError("tool_not_registered"));
  });

  it("rejects invalid registration and schema drift", () => {
    expect(() => new ToolRegistry().register(definition({ id: "../module" }))).toThrow("tool_id_invalid");
    expect(() => new ToolRegistry().register(definition({ inputSchemaDocument: { type: undefined } }))).toThrow("tool_schema_invalid");
    expect(() => new ToolRegistry().register(definition({ risk: "WRITE", concurrency: "isolated" }))).toThrow("tool_write_concurrency_invalid");
    const registry = new ToolRegistry();
    registry.register(definition());
    expect(() => registry.resolve("room.read", "1.0.0", "0".repeat(64))).toThrow("tool_schema_digest_mismatch");
  });

  it("validates arguments and rejects oversized results", async () => {
    const registry = new ToolRegistry();
    registry.register(definition({ maxResultBytes: 5 }));
    await expect(registry.execute("room.read", "1.0.0", {}, { runId: "r", toolCallId: "c" })).rejects.toThrow("tool_arguments_invalid");
    await expect(registry.execute("room.read", "1.0.0", { roomId: "room-1" }, { runId: "r", toolCallId: "c" })).rejects.toThrow("tool_result_too_large");
  });

  it("requires keyed write tools to receive their ledger key", async () => {
    const registry = new ToolRegistry();
    registry.register(definition({ idempotency: "KEYED", maxResultBytes: 128 }));
    await expect(registry.execute("room.read", "1.0.0", { roomId: "room-1" }, { runId: "r", toolCallId: "c" })).rejects.toThrow("tool_idempotency_key_required");
    await expect(registry.execute("room.read", "1.0.0", { roomId: "room-1" }, { runId: "r", toolCallId: "c", idempotencyKey: "r:c:digest" })).resolves.toEqual({ id: "room-1" });
  });

  it("only discloses schemas in explicitly full mode", () => {
    const registry = new ToolRegistry();
    registry.register(definition());
    expect(registry.disclose("index")[0]).not.toHaveProperty("inputSchema");
    expect(registry.disclose("full")[0]).toHaveProperty("inputSchema");
  });
});
