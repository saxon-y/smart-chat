import { McpGatewayError } from "./gateway";
import type { McpCallTransport, McpDiscoveredTool, McpDiscoveryPort, McpServerConfig, McpTransportRequest, McpTransportResponse } from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface McpJsonRpcTransportOptions {
  fetch?: FetchLike;
  /** Optional clock-independent request id source, useful for deterministic tests. */
  requestId?: () => string | number;
}

function headersFor(credentials: Readonly<Record<string, string>>): Headers {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream" });
  for (const [key, value] of Object.entries(credentials)) {
    headers.set(key.toLowerCase() === "authorization" ? "authorization" : `x-mcp-credential-${key}`, value);
  }
  return headers;
}

function parseSse(text: string): unknown {
  const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
  return JSON.parse(data || text);
}

function rpcResult(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new McpGatewayError("mcp_invalid_response");
  const value = payload as Record<string, unknown>;
  if (value.error && typeof value.error === "object") {
    const error = value.error as Record<string, unknown>;
    throw new McpGatewayError((typeof error.code === "string" || typeof error.code === "number") ? `mcp_remote_${String(error.code)}` : "mcp_remote_error");
  }
  if (!("result" in value) || !value.result || typeof value.result !== "object") throw new McpGatewayError("mcp_invalid_response");
  return value.result as Record<string, unknown>;
}

/** Minimal MCP JSON-RPC 2.0 transport for HTTP and SSE endpoints. */
export class McpJsonRpcTransport implements McpCallTransport {
  private sequence = 0;
  private readonly fetchImpl: FetchLike;
  private readonly requestIdFactory: () => string | number;

  constructor(options: McpJsonRpcTransportOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.requestIdFactory = options.requestId ?? (() => ++this.sequence);
  }

  async callTool(request: McpTransportRequest): Promise<McpTransportResponse> {
    const result = await this.request(request.endpoint, "tools/call", { name: request.toolName, arguments: request.arguments }, request.credentials, request.signal, request.maxResponseBytes);
    return { content: result, byteLength: Buffer.byteLength(JSON.stringify(result), "utf8") };
  }

  async listTools(server: McpServerConfig): Promise<readonly McpDiscoveredTool[]> {
    const result = await this.request(server.endpoint, "tools/list", {}, {}, new AbortController().signal, Number.MAX_SAFE_INTEGER);
    const tools = result.tools;
    if (!Array.isArray(tools)) throw new McpGatewayError("mcp_invalid_tools_list");
    return tools.map((tool) => {
      if (!tool || typeof tool !== "object" || typeof (tool as Record<string, unknown>).name !== "string") throw new McpGatewayError("mcp_invalid_tools_list");
      const value = tool as Record<string, unknown>;
      return { name: value.name as string, description: typeof value.description === "string" ? value.description : undefined, inputSchema: (value.inputSchema && typeof value.inputSchema === "object" ? value.inputSchema : {}) as Readonly<Record<string, unknown>> };
    });
  }

  private async request(endpoint: string, method: string, params: unknown, credentials: Readonly<Record<string, string>>, signal: AbortSignal, maxBytes: number): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, { method: "POST", headers: headersFor(credentials), body: JSON.stringify({ jsonrpc: "2.0", id: this.requestIdFactory(), method, params }), signal, redirect: "manual" });
    } catch {
      throw new McpGatewayError("mcp_connection_lost", false);
    }
    if (response.type === "opaqueredirect" || response.status >= 300 && response.status < 400) throw new McpGatewayError("mcp_redirect", false);
    const text = await response.text();
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) throw new McpGatewayError("mcp_response_too_large");
    if (!response.ok) throw new McpGatewayError(`mcp_http_${response.status}`, response.status < 500);
    let payload: unknown;
    try { payload = (response.headers.get("content-type") ?? "").includes("text/event-stream") ? parseSse(text) : JSON.parse(text); } catch { throw new McpGatewayError("mcp_invalid_response"); }
    return rpcResult(payload);
  }
}

export class McpJsonRpcDiscovery implements McpDiscoveryPort {
  constructor(private readonly transport: McpJsonRpcTransport = new McpJsonRpcTransport()) {}
  listTools(server: McpServerConfig): Promise<readonly McpDiscoveredTool[]> { return this.transport.listTools(server); }
}
