import { sha256Digest } from "../protocol/canonical";
import type { McpConfigSnapshot, McpServerConfig } from "./types";

export class McpConfigError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "McpConfigError";
  }
}

function snapshotPayload(revision: number, servers: readonly McpServerConfig[]) {
  return { revision, servers };
}

function cloneServers(servers: readonly McpServerConfig[]): readonly McpServerConfig[] {
  return servers.map((server) => Object.freeze({
    ...server,
    allowedHosts: Object.freeze([...server.allowedHosts]),
    secretRefs: Object.freeze({ ...server.secretRefs }),
    approvedTools: Object.freeze(server.approvedTools.map((tool) => Object.freeze({
      ...tool,
      inputSchema: Object.freeze({ ...tool.inputSchema }),
    }))),
  }));
}

/** In-memory reference implementation; persistence adapters must preserve immutable revisions. */
export class McpConfigRevisionStore {
  private readonly snapshots = new Map<number, McpConfigSnapshot>();

  publish(revision: number, servers: readonly McpServerConfig[]): McpConfigSnapshot {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new McpConfigError("mcp_revision_invalid");
    if (this.snapshots.has(revision)) throw new McpConfigError("mcp_revision_exists");
    const cloned = cloneServers(servers);
    const snapshot = Object.freeze({ revision, servers: Object.freeze(cloned), digest: sha256Digest(snapshotPayload(revision, cloned)) });
    this.snapshots.set(revision, snapshot);
    return snapshot;
  }

  resolve(revision: number, expectedDigest: string): McpConfigSnapshot {
    const snapshot = this.snapshots.get(revision);
    if (!snapshot) throw new McpConfigError("mcp_revision_not_found");
    if (snapshot.digest !== expectedDigest) throw new McpConfigError("mcp_config_digest_mismatch");
    return snapshot;
  }
}

export function taskMcpReference(snapshot: McpConfigSnapshot) {
  return Object.freeze({ revision: snapshot.revision, digest: snapshot.digest });
}
