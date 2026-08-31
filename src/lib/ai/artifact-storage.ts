import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type ArtifactPutResult = {
  objectKey: string;
  sha256: string;
  byteSize: number;
};

export interface ArtifactStorage {
  put(objectKey: string, bytes: Uint8Array): Promise<ArtifactPutResult>;
  get(objectKey: string): Promise<Buffer | null>;
  delete(objectKey: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

function defaultRoot() {
  return process.env.ARTIFACT_STORAGE_DIR
    ? path.resolve(process.env.ARTIFACT_STORAGE_DIR)
    : path.join(process.cwd(), ".data");
}

function assertObjectKey(objectKey: string) {
  if (!objectKey || objectKey.startsWith("/") || objectKey.includes("\\") || objectKey.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("invalid_artifact_object_key");
  }
}

export class LocalArtifactStorage implements ArtifactStorage {
  readonly root: string;

  constructor(root = defaultRoot()) {
    this.root = path.resolve(root);
  }

  private filePath(objectKey: string) {
    assertObjectKey(objectKey);
    const filePath = path.resolve(this.root, objectKey);
    if (!filePath.startsWith(`${this.root}${path.sep}`)) throw new Error("invalid_artifact_object_key");
    return filePath;
  }

  async put(objectKey: string, bytes: Uint8Array): Promise<ArtifactPutResult> {
    const filePath = this.filePath(objectKey);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700).catch(() => undefined);
    const buffer = Buffer.from(bytes);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
    try {
      await link(temporaryPath, filePath).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      await unlink(temporaryPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return { objectKey, sha256: createHash("sha256").update(buffer).digest("hex"), byteSize: buffer.length };
  }

  async get(objectKey: string) {
    return readFile(this.filePath(objectKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  }

  async delete(objectKey: string) {
    await unlink(this.filePath(objectKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async list(prefix = "") {
    const normalizedPrefix = prefix.replace(/\/+$/, "");
    if (normalizedPrefix) assertObjectKey(normalizedPrefix);
    const start = normalizedPrefix ? this.filePath(normalizedPrefix) : this.root;
    const result: string[] = [];
    const walk = async (directory: string) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile()) result.push(path.relative(this.root, absolute).split(path.sep).join("/"));
      }
    };
    await stat(start).then(() => walk(start)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return result.filter((key) => key.startsWith(normalizedPrefix ? `${normalizedPrefix}/` : ""));
  }
}

export function createArtifactStorage(): ArtifactStorage {
  const backend = process.env.ARTIFACT_STORAGE_BACKEND?.toLowerCase() ?? "local";
  if (backend !== "local") throw new Error(`unsupported_artifact_storage_backend:${backend}`);
  if (process.env.NODE_ENV === "production" && !process.env.ARTIFACT_STORAGE_DIR) throw new Error("artifact_storage_not_configured");
  return new LocalArtifactStorage();
}
