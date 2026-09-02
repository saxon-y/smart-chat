import type { McpCallTransport, McpConfigSnapshot, McpGatewayLimits, McpSecretResolver, McpServerConfig, McpToolResult } from "./types";

export class McpGatewayError extends Error {
  constructor(readonly code: string, readonly outcomeKnown = true) {
    super(code);
    this.name = "McpGatewayError";
  }
}

function hostAllowed(url: string, server: McpServerConfig): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || (parsed.protocol === "http:" && parsed.hostname === "localhost"))
      && server.allowedHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function serializedSize(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return Buffer.byteLength(serialized, "utf8");
  } catch {
    throw new McpGatewayError("mcp_result_not_serializable");
  }
}

export class TaskScopedMcpGateway {
  private callCount = 0;
  private readonly activeByServer = new Map<string, number>();

  constructor(
    private readonly snapshot: McpConfigSnapshot,
    private readonly transport: McpCallTransport,
    private readonly secrets: McpSecretResolver,
    private readonly limits: McpGatewayLimits,
  ) {
    if (!Number.isSafeInteger(limits.maxCalls) || limits.maxCalls <= 0
      || !Number.isSafeInteger(limits.maxConcurrencyPerServer) || limits.maxConcurrencyPerServer <= 0
      || !Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs <= 0
      || !Number.isSafeInteger(limits.maxResponseBytes) || limits.maxResponseBytes <= 0
      || !Number.isSafeInteger(limits.maxReadRetries) || limits.maxReadRetries < 0) {
      throw new McpGatewayError("mcp_limits_invalid");
    }
  }

  async call(serverId: string, toolName: string, argumentsValue: unknown): Promise<McpToolResult> {
    const server = this.snapshot.servers.find((candidate) => candidate.serverId === serverId);
    if (!server) throw new McpGatewayError("mcp_server_not_approved");
    const tool = server.approvedTools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new McpGatewayError("mcp_tool_not_approved");
    if (!hostAllowed(server.endpoint, server)) throw new McpGatewayError("mcp_host_not_allowed");
    if (++this.callCount > this.limits.maxCalls) throw new McpGatewayError("mcp_call_limit_exceeded");
    const active = this.activeByServer.get(serverId) ?? 0;
    if (active >= this.limits.maxConcurrencyPerServer) throw new McpGatewayError("mcp_concurrency_limit_exceeded");
    this.activeByServer.set(serverId, active + 1);

    try {
      let credentials: Readonly<Record<string, string>>;
      try {
        credentials = Object.fromEntries(await Promise.all(Object.entries(server.secretRefs).map(async ([key, ref]) => [key, await this.secrets.resolve(ref)])));
      } catch {
        throw new McpGatewayError("mcp_secret_resolution_failed");
      }
      const maxAttempts = tool.risk === "READ" ? 1 + this.limits.maxReadRetries : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await this.invoke(server, toolName, argumentsValue, credentials);
          if (response.finalUrl && !hostAllowed(response.finalUrl, server)) throw new McpGatewayError("mcp_redirect_host_not_allowed");
          const size = response.byteLength ?? serializedSize(response.content);
          if (size > this.limits.maxResponseBytes) throw new McpGatewayError("mcp_response_too_large");
          return { status: "SUCCEEDED", content: response.content, outcomeKnown: true, attempts: attempt };
        } catch (error) {
          const normalized = error instanceof McpGatewayError ? error : new McpGatewayError("mcp_transport_failed", false);
          if (!normalized.outcomeKnown && tool.risk !== "READ" && tool.idempotency === "NON_IDEMPOTENT") {
            return { status: "BLOCKED", content: null, errorCode: "mcp_write_outcome_unknown", outcomeKnown: false, attempts: attempt };
          }
          if (tool.risk === "READ" && attempt < maxAttempts) continue;
          return { status: "FAILED", content: null, errorCode: normalized.code, outcomeKnown: normalized.outcomeKnown, attempts: attempt };
        }
      }
      throw new McpGatewayError("mcp_unreachable");
    } finally {
      const remaining = (this.activeByServer.get(serverId) ?? 1) - 1;
      if (remaining === 0) this.activeByServer.delete(serverId);
      else this.activeByServer.set(serverId, remaining);
    }
  }

  private async invoke(server: McpServerConfig, toolName: string, argumentsValue: unknown, credentials: Readonly<Record<string, string>>) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new McpGatewayError("mcp_timeout", false));
      }, this.limits.timeoutMs);
    });
    try {
      return await Promise.race([this.transport.callTool({ serverId: server.serverId, endpoint: server.endpoint, toolName, arguments: argumentsValue, credentials, signal: controller.signal, maxResponseBytes: this.limits.maxResponseBytes }), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
