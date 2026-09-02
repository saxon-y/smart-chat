import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ReadToolRepository } from "./read-tools";

export function createPrismaReadToolRepository(database: PrismaClient = db): ReadToolRepository {
  return {
    findRoom(roomId) {
      return database.room.findUnique({
        where: { id: roomId },
        select: { id: true, name: true, slug: true, visibility: true, status: true, createdAt: true, updatedAt: true },
      });
    },
    findArtifactInRoom(roomId, artifactId) {
      return database.artifact.findFirst({
        where: { id: artifactId, deletedAt: null, run: { roomId } },
        select: { id: true, runId: true, mimeType: true, width: true, height: true, byteSize: true, sha256: true, moderationStatus: true, expiresAt: true, createdAt: true },
      });
    },
  };
}
