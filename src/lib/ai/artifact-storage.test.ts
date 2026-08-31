import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalArtifactStorage } from "./artifact-storage";

describe("LocalArtifactStorage", () => {
  it("stores, reads, lists, and deletes private objects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "smart-chat-artifacts-"));
    try {
      const storage = new LocalArtifactStorage(root);
      const result = await storage.put("generated/example.png", Buffer.from("image"));
      expect(result.byteSize).toBe(5);
      expect(result.sha256).toHaveLength(64);
      expect(await storage.get("generated/example.png")).toEqual(Buffer.from("image"));
      expect(await storage.list("generated/")).toEqual(["generated/example.png"]);
      await storage.put("generated/example.png", Buffer.from("different"));
      expect(await storage.get("generated/example.png")).toEqual(Buffer.from("image"));
      await storage.delete("generated/example.png");
      expect(await storage.get("generated/example.png")).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal and absolute object keys", async () => {
    const storage = new LocalArtifactStorage(await mkdtemp(path.join(os.tmpdir(), "smart-chat-artifacts-")));
    await expect(storage.get("../outside")).rejects.toThrow("invalid_artifact_object_key");
    await expect(storage.get("/outside")).rejects.toThrow("invalid_artifact_object_key");
  });
});
