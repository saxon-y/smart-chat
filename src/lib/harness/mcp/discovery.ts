import { sha256Digest } from "../protocol/canonical";
import type { McpAuditPort, McpConfigSnapshot, McpDiscoveryPort } from "./types";

export class McpDiscoveryError extends Error {
  constructor(readonly code: string, readonly serverId: string, readonly toolName?: string) {
    super(code);
    this.name = "McpDiscoveryError";
  }
}

export async function verifyMcpDiscovery(snapshot: McpConfigSnapshot, discovery: McpDiscoveryPort, audit: McpAuditPort): Promise<void> {
  for (const server of snapshot.servers) {
    try {
      const discovered = await discovery.listTools(server);
      const byName = new Map(discovered.map((tool) => [tool.name, tool]));
      for (const approved of server.approvedTools) {
        const actual = byName.get(approved.name);
        if (!actual) throw new McpDiscoveryError("mcp_tool_missing", server.serverId, approved.name);
        if (sha256Digest(actual.inputSchema) !== approved.schemaDigest) {
          throw new McpDiscoveryError("mcp_schema_drift", server.serverId, approved.name);
        }
      }
      await audit.record({ type: "mcp_discovery", serverId: server.serverId, revision: snapshot.revision, accepted: true });
    } catch (error) {
      const normalized = error instanceof McpDiscoveryError ? error : new McpDiscoveryError("mcp_discovery_failed", server.serverId);
      await audit.record({ type: "mcp_discovery", serverId: server.serverId, revision: snapshot.revision, accepted: false, code: normalized.code });
      throw normalized;
    }
  }
}
