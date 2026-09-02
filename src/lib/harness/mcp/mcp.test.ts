import { describe, expect, it, vi } from "vitest";
import { sha256Digest } from "../protocol/canonical";
import { McpConfigRevisionStore, taskMcpReference } from "./config";
import { McpDiscoveryError, verifyMcpDiscovery } from "./discovery";
import { McpGatewayError, TaskScopedMcpGateway } from "./gateway";
import { McpJsonRpcDiscovery, McpJsonRpcTransport } from "./transport";
import type { McpCallTransport, McpConfigSnapshot, McpGatewayLimits, McpServerConfig } from "./types";

const schema = { type: "object", properties: { query: { type: "string" } } };

function server(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    serverId: "search",
    transport: "http",
    endpoint: "https://mcp.example.test/rpc",
    allowedHosts: ["mcp.example.test"],
    secretRefs: { authorization: "vault://mcp/token" },
    approvedTools: [{
      name: "lookup",
      description: "Lookup",
      inputSchema: schema,
      schemaDigest: sha256Digest(schema),
      risk: "READ",
      idempotency: "READ_ONLY",
    }],
    ...overrides,
  };
}

function snapshot(serverConfig = server()): McpConfigSnapshot {
  return new McpConfigRevisionStore().publish(4, [serverConfig]);
}

const limits: McpGatewayLimits = {
  maxCalls: 2,
  maxConcurrencyPerServer: 1,
  timeoutMs: 50,
  maxResponseBytes: 64,
  maxReadRetries: 1,
};

describe("MCP configuration and discovery", () => {
  it("pins immutable revisions and exposes only revision/digest to a task", () => {
    const store = new McpConfigRevisionStore();
    const config = server();
    const saved = store.publish(7, [config]);
    config.allowedHosts = ["evil.test"];
    expect(saved.servers[0].allowedHosts).toEqual(["mcp.example.test"]);
    expect(taskMcpReference(saved)).toEqual({ revision: 7, digest: saved.digest });
    expect(JSON.stringify(taskMcpReference(saved))).not.toContain("vault://");
    expect(store.resolve(7, saved.digest)).toBe(saved);
    expect(() => store.publish(7, [])).toThrowError("mcp_revision_exists");
  });

  it("rejects canonical schema drift and records the failed discovery", async () => {
    const audit = { record: vi.fn(async () => undefined) };
    await expect(verifyMcpDiscovery(snapshot(), {
      listTools: async () => [{ name: "lookup", inputSchema: { type: "object", properties: {} } }],
    }, audit)).rejects.toMatchObject({ code: "mcp_schema_drift", serverId: "search", toolName: "lookup" } satisfies Partial<McpDiscoveryError>);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ accepted: false, code: "mcp_schema_drift" }));
  });

  it("accepts semantically identical schemas regardless of key order", async () => {
    const audit = { record: vi.fn(async () => undefined) };
    await verifyMcpDiscovery(snapshot(), {
      listTools: async () => [{ name: "lookup", inputSchema: { properties: { query: { type: "string" } }, type: "object" } }],
    }, audit);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }));
  });
});

describe("TaskScopedMcpGateway", () => {
  it("injects resolved credentials only into the transport and does not return them", async () => {
    const transport = { callTool: vi.fn(async (request) => ({ content: { answer: 42, sawAuth: Boolean(request.credentials.authorization) } })) } satisfies McpCallTransport;
    const gateway = new TaskScopedMcpGateway(snapshot(), transport, { resolve: async () => "top-secret" }, limits);
    const result = await gateway.call("search", "lookup", { query: "x" });
    expect(result).toMatchObject({ status: "SUCCEEDED", content: { answer: 42, sawAuth: true } });
    expect(JSON.stringify(result)).not.toContain("top-secret");

    const failed = new TaskScopedMcpGateway(snapshot(), transport, { resolve: async () => { throw new Error("top-secret"); } }, limits);
    await expect(failed.call("search", "lookup", {})).rejects.toMatchObject({ code: "mcp_secret_resolution_failed", message: "mcp_secret_resolution_failed" });
  });

  it("rejects an endpoint or redirect outside the allowlist", async () => {
    const transport: McpCallTransport = { callTool: async () => ({ content: {}, finalUrl: "https://evil.test/result" }) };
    const gateway = new TaskScopedMcpGateway(snapshot(), transport, { resolve: async () => "secret" }, limits);
    expect(await gateway.call("search", "lookup", {})).toMatchObject({ status: "FAILED", errorCode: "mcp_redirect_host_not_allowed" });

    const badEndpoint = new TaskScopedMcpGateway(snapshot(server({ endpoint: "https://evil.test/rpc" })), transport, { resolve: async () => "secret" }, limits);
    await expect(badEndpoint.call("search", "lookup", {})).rejects.toMatchObject({ code: "mcp_host_not_allowed" } satisfies Partial<McpGatewayError>);
  });

  it("enforces count, per-server concurrency, timeout, and response size", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const transport: McpCallTransport = { callTool: async () => { await pending; return { content: {} }; } };
    const concurrent = new TaskScopedMcpGateway(snapshot(), transport, { resolve: async () => "secret" }, limits);
    const first = concurrent.call("search", "lookup", {});
    await vi.waitFor(() => expect(transport.callTool).toBeDefined());
    await expect(concurrent.call("search", "lookup", {})).rejects.toMatchObject({ code: "mcp_concurrency_limit_exceeded" });
    release();
    await first;

    const count = new TaskScopedMcpGateway(snapshot(), { callTool: async () => ({ content: {} }) }, { resolve: async () => "secret" }, { ...limits, maxCalls: 1 });
    await count.call("search", "lookup", {});
    await expect(count.call("search", "lookup", {})).rejects.toMatchObject({ code: "mcp_call_limit_exceeded" });

    const large = new TaskScopedMcpGateway(snapshot(), { callTool: async () => ({ content: "x".repeat(100) }) }, { resolve: async () => "secret" }, limits);
    expect(await large.call("search", "lookup", {})).toMatchObject({ status: "FAILED", errorCode: "mcp_response_too_large" });

    const timeout = new TaskScopedMcpGateway(snapshot(), { callTool: async () => new Promise(() => undefined) }, { resolve: async () => "secret" }, { ...limits, timeoutMs: 5, maxReadRetries: 0 });
    expect(await timeout.call("search", "lookup", {})).toMatchObject({ status: "FAILED", errorCode: "mcp_timeout", outcomeKnown: false });
  });

  it("retries reads but blocks an unknown non-idempotent write without retry", async () => {
    const readTransport = { callTool: vi.fn().mockRejectedValueOnce(new McpGatewayError("mcp_connection_lost", false)).mockResolvedValueOnce({ content: "ok" }) };
    const readGateway = new TaskScopedMcpGateway(snapshot(), readTransport, { resolve: async () => "secret" }, limits);
    expect(await readGateway.call("search", "lookup", {})).toMatchObject({ status: "SUCCEEDED", attempts: 2 });

    const writeServer = server({ approvedTools: [{ ...server().approvedTools[0], risk: "WRITE", idempotency: "NON_IDEMPOTENT" }] });
    const writeTransport = { callTool: vi.fn().mockRejectedValue(new McpGatewayError("mcp_connection_lost", false)) };
    const writeGateway = new TaskScopedMcpGateway(snapshot(writeServer), writeTransport, { resolve: async () => "secret" }, limits);
    expect(await writeGateway.call("search", "lookup", {})).toMatchObject({ status: "BLOCKED", errorCode: "mcp_write_outcome_unknown", outcomeKnown: false, attempts: 1 });
    expect(writeTransport.callTool).toHaveBeenCalledTimes(1);
  });
});

describe("McpJsonRpcTransport", () => {
  function response(body: string, init: ResponseInit = {}) {
    return new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });
  }

  it("sends tools/call JSON-RPC requests and keeps credentials in headers", async () => {
    let seen: { body: Record<string, unknown>; headers: Headers } | undefined;
    const transport = new McpJsonRpcTransport({
      requestId: () => "fixed-id",
      fetch: async (_input, init) => {
        seen = { body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) };
        return response(JSON.stringify({ jsonrpc: "2.0", id: "fixed-id", result: { content: [{ type: "text", text: "ok" }] } }));
      },
    });
    const result = await transport.callTool({ serverId: "s", endpoint: "https://mcp.example.test", toolName: "lookup", arguments: { q: "x" }, credentials: { authorization: "secret", tenant: "acme" }, signal: new AbortController().signal, maxResponseBytes: 1024 });
    expect(result.content).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(seen?.body).toMatchObject({ jsonrpc: "2.0", id: "fixed-id", method: "tools/call", params: { name: "lookup", arguments: { q: "x" } } });
    expect(seen?.headers.get("authorization")).toBe("secret");
    expect(seen?.headers.get("x-mcp-credential-tenant")).toBe("acme");
  });

  it("maps tools/list responses for discovery, including SSE payloads", async () => {
    const transport = new McpJsonRpcTransport({ fetch: async () => new Response("data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"lookup\",\"inputSchema\":{\"type\":\"object\"}}]}}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }) });
    await expect(new McpJsonRpcDiscovery(transport).listTools(server())).resolves.toEqual([{ name: "lookup", inputSchema: { type: "object" }, description: undefined }]);
  });

  it("rejects oversized, malformed, and JSON-RPC error responses", async () => {
    const oversized = new McpJsonRpcTransport({ fetch: async () => response("x".repeat(20)) });
    await expect(oversized.callTool({ serverId: "s", endpoint: "https://mcp.example.test", toolName: "x", arguments: {}, credentials: {}, signal: new AbortController().signal, maxResponseBytes: 5 })).rejects.toMatchObject({ code: "mcp_response_too_large" });
    const malformed = new McpJsonRpcTransport({ fetch: async () => response("{}") });
    await expect(malformed.callTool({ serverId: "s", endpoint: "https://mcp.example.test", toolName: "x", arguments: {}, credentials: {}, signal: new AbortController().signal, maxResponseBytes: 100 })).rejects.toMatchObject({ code: "mcp_invalid_response" });
    const remote = new McpJsonRpcTransport({ fetch: async () => response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601 } })) });
    await expect(remote.callTool({ serverId: "s", endpoint: "https://mcp.example.test", toolName: "x", arguments: {}, credentials: {}, signal: new AbortController().signal, maxResponseBytes: 100 })).rejects.toMatchObject({ code: "mcp_remote_-32601" });
  });
});
