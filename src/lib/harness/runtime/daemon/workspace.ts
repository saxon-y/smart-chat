import { lstat, mkdir, mkdtemp, opendir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ArtifactStorage, ArtifactPutResult } from "@/lib/ai/artifact-storage";

export type WorkspaceSpec = {
  mode: "ephemeral" | "durable";
  allowedPaths?: string[];
  preserveOnFailure?: boolean;
  maxBytes: number;
};

export type ManagedWorkspace = {
  runId: string;
  root: string;
  spec: WorkspaceSpec;
};

export class WorkspaceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WorkspaceError";
  }
}

const BEGIN_MARKER = "<!-- SMART_CHAT_CONTEXT:BEGIN -->";
const END_MARKER = "<!-- SMART_CHAT_CONTEXT:END -->";

function assertRunId(runId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) throw new WorkspaceError("workspace_run_id_invalid");
}

function assertRelative(relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\\")) throw new WorkspaceError("workspace_path_invalid");
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new WorkspaceError("workspace_path_invalid");
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  const visit = async (directory: string) => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new WorkspaceError("workspace_symlink_forbidden");
      if (info.isDirectory()) await visit(absolute);
      else if (info.isFile()) total += info.size;
    }
  };
  await visit(root);
  return total;
}

export class WorkspaceManager {
  readonly root: string;

  constructor(root = path.join(os.tmpdir(), "smart-chat-workspaces")) {
    this.root = path.resolve(root);
  }

  async create(runId: string, spec: WorkspaceSpec): Promise<ManagedWorkspace> {
    assertRunId(runId);
    if (!Number.isSafeInteger(spec.maxBytes) || spec.maxBytes <= 0) throw new WorkspaceError("workspace_size_limit_invalid");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = spec.mode === "ephemeral"
      ? await mkdtemp(path.join(this.root, `${runId}-`))
      : path.join(this.root, runId);
    if (spec.mode === "durable") await mkdir(directory, { recursive: true, mode: 0o700 });
    return { runId, root: directory, spec: { ...spec, allowedPaths: spec.allowedPaths ? [...spec.allowedPaths] : undefined } };
  }

  private async resolve(workspace: ManagedWorkspace, relativePath: string, createParents = false) {
    assertRelative(relativePath);
    const allowed = workspace.spec.allowedPaths;
    allowed?.forEach(assertRelative);
    if (allowed?.length && !allowed.some((rawPrefix) => {
      const prefix = rawPrefix.replace(/\/$/, "");
      return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
    })) {
      throw new WorkspaceError("workspace_path_not_allowed");
    }
    const workspaceRoot = await realpath(workspace.root);
    const target = path.resolve(workspaceRoot, relativePath);
    if (!target.startsWith(`${workspaceRoot}${path.sep}`)) throw new WorkspaceError("workspace_path_invalid");
    const parent = path.dirname(target);
    const relativeParent = path.relative(workspaceRoot, parent);
    let cursor = workspaceRoot;
    for (const part of relativeParent.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      const info = await lstat(cursor).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT" || !createParents) throw error;
        await mkdir(cursor, { mode: 0o700 });
        return lstat(cursor);
      });
      if (info.isSymbolicLink()) throw new WorkspaceError("workspace_symlink_forbidden");
    }
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (existing?.isSymbolicLink()) throw new WorkspaceError("workspace_symlink_forbidden");
    return target;
  }

  async write(workspace: ManagedWorkspace, relativePath: string, bytes: Uint8Array | string) {
    const target = await this.resolve(workspace, relativePath, true);
    const buffer = Buffer.from(bytes);
    const existingBytes = await stat(target).then((value) => value.size).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? 0 : Promise.reject(error));
    const currentBytes = await directorySize(workspace.root);
    if (currentBytes - existingBytes + buffer.length > workspace.spec.maxBytes) throw new WorkspaceError("workspace_size_exceeded");
    await writeFile(target, buffer, { mode: 0o600 });
  }

  async injectContext(workspace: ManagedWorkspace, relativePath: string, context: string) {
    const target = await this.resolve(workspace, relativePath, true);
    const current = await readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "" : Promise.reject(error));
    const block = `${BEGIN_MARKER}\n${context}\n${END_MARKER}`;
    const begin = current.indexOf(BEGIN_MARKER);
    const end = current.indexOf(END_MARKER);
    const next = begin >= 0 && end > begin
      ? `${current.slice(0, begin)}${block}${current.slice(end + END_MARKER.length)}`
      : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${block}\n`;
    await this.write(workspace, relativePath, next);
  }

  async uploadArtifact(workspace: ManagedWorkspace, relativePath: string, objectKey: string, storage: ArtifactStorage): Promise<ArtifactPutResult> {
    const target = await this.resolve(workspace, relativePath);
    const info = await lstat(target);
    if (!info.isFile()) throw new WorkspaceError("workspace_artifact_not_file");
    return storage.put(objectKey, await readFile(target));
  }

  async cleanup(workspace: ManagedWorkspace, outcome: "success" | "failure") {
    const preserve = workspace.spec.mode === "durable" || (outcome === "failure" && workspace.spec.preserveOnFailure);
    if (!preserve) await rm(workspace.root, { recursive: true, force: true });
    return { preserved: preserve };
  }
}
