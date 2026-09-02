import { z } from "zod";
import type { ToolDefinition } from "../types";

export interface RoomInfo {
  id: string;
  name: string;
  slug: string;
  visibility: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArtifactMetadata {
  id: string;
  runId: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  sha256: string | null;
  moderationStatus: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ReadToolRepository {
  findRoom(roomId: string): Promise<RoomInfo | null>;
  findArtifactInRoom(roomId: string, artifactId: string): Promise<ArtifactMetadata | null>;
}

const roomInput = z.strictObject({ roomId: z.string().min(1) });
const artifactInput = z.strictObject({ roomId: z.string().min(1), artifactId: z.string().min(1) });

export function createReadToolDefinitions(repository: ReadToolRepository): ToolDefinition[] {
  return [
    {
      id: "room.info.read",
      version: "1.0.0",
      description: "Read current room metadata",
      category: "perception",
      inputSchema: roomInput,
      inputSchemaDocument: { type: "object", additionalProperties: false, required: ["roomId"], properties: { roomId: { type: "string", minLength: 1 } } },
      risk: "READ",
      idempotency: "READ_ONLY",
      concurrency: "isolated",
      timeoutMs: 5_000,
      maxResultBytes: 16_384,
      requiredCapabilities: ["room:read"],
      async execute({ roomId }) {
        const room = await repository.findRoom(roomId);
        if (!room) throw new Error("room_not_found");
        return { ...room, createdAt: room.createdAt.toISOString(), updatedAt: room.updatedAt.toISOString() };
      },
    },
    {
      id: "artifact.metadata.read",
      version: "1.0.0",
      description: "Read metadata for an artifact belonging to the current room",
      category: "perception",
      inputSchema: artifactInput,
      inputSchemaDocument: { type: "object", additionalProperties: false, required: ["roomId", "artifactId"], properties: { roomId: { type: "string", minLength: 1 }, artifactId: { type: "string", minLength: 1 } } },
      risk: "READ",
      idempotency: "READ_ONLY",
      concurrency: "isolated",
      timeoutMs: 5_000,
      maxResultBytes: 16_384,
      requiredCapabilities: ["artifact:read"],
      async execute({ roomId, artifactId }) {
        const artifact = await repository.findArtifactInRoom(roomId, artifactId);
        if (!artifact) throw new Error("artifact_not_found");
        return { ...artifact, createdAt: artifact.createdAt.toISOString(), expiresAt: artifact.expiresAt?.toISOString() ?? null };
      },
    },
  ];
}
