import type { ToolRisk } from "../tools/types";

export type McpTransportKind = "http" | "sse" | "stdio";

export interface McpApprovedTool {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  schemaDigest: string;
  risk: ToolRisk;
  idempotency: "READ_ONLY" | "KEYED" | "NON_IDEMPOTENT";
}

export interface McpServerConfig {
  serverId: string;
  transport: McpTransportKind;
  endpoint: string;
  allowedHosts: readonly string[];
  secretRefs: Readonly<Record<string, string>>;
  approvedTools: readonly McpApprovedTool[];
}

export interface McpConfigSnapshot {
  revision: number;
  digest: string;
  servers: readonly McpServerConfig[];
}

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpDiscoveryPort {
  listTools(server: McpServerConfig): Promise<readonly McpDiscoveredTool[]>;
}

export interface McpAuditPort {
  record(event: { type: "mcp_discovery"; serverId: string; revision: number; accepted: boolean; code?: string }): Promise<void>;
}

export interface McpSecretResolver {
  resolve(reference: string): Promise<string>;
}

export interface McpTransportRequest {
  serverId: string;
  endpoint: string;
  toolName: string;
  arguments: unknown;
  credentials: Readonly<Record<string, string>>;
  signal: AbortSignal;
  maxResponseBytes: number;
}

export interface McpTransportResponse {
  content: unknown;
  finalUrl?: string;
  byteLength?: number;
}

export interface McpCallTransport {
  callTool(request: McpTransportRequest): Promise<McpTransportResponse>;
}

export interface McpToolResult {
  status: "SUCCEEDED" | "FAILED" | "BLOCKED";
  content: unknown;
  errorCode?: string;
  outcomeKnown: boolean;
  attempts: number;
}

export interface McpGatewayLimits {
  maxCalls: number;
  maxConcurrencyPerServer: number;
  timeoutMs: number;
  maxResponseBytes: number;
  maxReadRetries: number;
}
