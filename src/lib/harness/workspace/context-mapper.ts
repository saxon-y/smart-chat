import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export const HARNESS_MARKER_BEGIN = "<!-- BEGIN SMART-CHAT HARNESS -->";
export const HARNESS_MARKER_END = "<!-- END SMART-CHAT HARNESS -->";

const RUN_FILES = {
  system: ".run/SYSTEM.md",
  agent: ".run/AGENT.md",
  task: ".run/TASK.md",
  roomContext: ".run/ROOM_CONTEXT.md",
  memory: ".run/MEMORY.md",
} as const;

const RUNTIME_ENTRIES = {
  codex: "AGENTS.md",
  claude: "CLAUDE.md",
  qwen: "QWEN.md",
} as const;

export type RuntimeContextFiles = {
  system: string;
  agent: string;
  task: string;
  roomContext: string;
  memory: string;
  policy: unknown;
};

export type RuntimeKind = keyof typeof RUNTIME_ENTRIES;

export type PreparedRuntimeWorkspace = {
  runDirectory: string;
  files: readonly string[];
};

function safeTarget(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("workspace_path_invalid");
  }
  const target = resolve(root, relativePath);
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("workspace_path_outside_root");
  }
  return target;
}

async function assertNoSymlink(root: string, target: string): Promise<void> {
  const fromRoot = relative(root, target);
  let current = root;
  for (const part of fromRoot.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("workspace_path_symlink");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

/** Atomically replaces a regular file below workspaceRoot without following symlinks. */
export async function atomicWriteWithinWorkspace(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const root = resolve(workspaceRoot);
  await mkdir(root, { recursive: true });
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error("workspace_root_not_directory");

  const target = safeTarget(root, relativePath);
  await assertNoSymlink(root, target);
  await mkdir(dirname(target), { recursive: true });
  await assertNoSymlink(root, target);

  let mode: number | undefined;
  try {
    const targetInfo = await lstat(target);
    if (!targetInfo.isFile()) throw new Error("workspace_target_not_regular_file");
    mode = targetInfo.mode;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: mode ?? 0o600 });
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
}

function managedContent(existing: string, body: string): string {
  const start = existing.indexOf(HARNESS_MARKER_BEGIN);
  const end = existing.indexOf(HARNESS_MARKER_END);
  const block = `${HARNESS_MARKER_BEGIN}\n${body.trimEnd()}\n${HARNESS_MARKER_END}`;

  if (start === -1 && end === -1) {
    if (!existing) return `${block}\n`;
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    return `${existing}${separator}${block}\n`;
  }
  if (start === -1 || end === -1 || end < start) throw new Error("workspace_managed_marker_invalid");
  const duplicateStart = existing.indexOf(HARNESS_MARKER_BEGIN, start + HARNESS_MARKER_BEGIN.length);
  const duplicateEnd = existing.indexOf(HARNESS_MARKER_END, end + HARNESS_MARKER_END.length);
  if (duplicateStart !== -1 || duplicateEnd !== -1) throw new Error("workspace_managed_marker_duplicate");
  return `${existing.slice(0, start)}${block}${existing.slice(end + HARNESS_MARKER_END.length)}`;
}

async function readOptional(path: string): Promise<string> {
  try {
    await access(path, constants.R_OK);
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function nativeEntry(runtime: RuntimeKind): string {
  return [
    `# Smart Chat ${runtime} runtime context`,
    "",
    "Read and follow these task-scoped context files in order:",
    "- `.run/SYSTEM.md`",
    "- `.run/AGENT.md`",
    "- `.run/TASK.md`",
    "- `.run/ROOM_CONTEXT.md`",
    "- `.run/MEMORY.md`",
    "- `.run/POLICY.json`",
  ].join("\n");
}

export async function prepareRuntimeWorkspace(
  workspaceRoot: string,
  context: RuntimeContextFiles,
  runtimes: readonly RuntimeKind[] = ["codex", "claude", "qwen"],
): Promise<PreparedRuntimeWorkspace> {
  const files: string[] = [];
  for (const [key, path] of Object.entries(RUN_FILES) as Array<[keyof typeof RUN_FILES, string]>) {
    await atomicWriteWithinWorkspace(workspaceRoot, path, `${context[key].trimEnd()}\n`);
    files.push(path);
  }
  const policyPath = ".run/POLICY.json";
  await atomicWriteWithinWorkspace(workspaceRoot, policyPath, `${JSON.stringify(context.policy, null, 2)}\n`);
  files.push(policyPath);

  for (const runtime of [...new Set(runtimes)]) {
    const path = RUNTIME_ENTRIES[runtime];
    if (!path) throw new Error(`runtime_context_unsupported:${runtime}`);
    const root = resolve(workspaceRoot);
    const target = safeTarget(root, path);
    await assertNoSymlink(root, target);
    const existing = await readOptional(target);
    await atomicWriteWithinWorkspace(workspaceRoot, path, managedContent(existing, nativeEntry(runtime)));
    files.push(path);
  }

  return { runDirectory: resolve(workspaceRoot, ".run"), files };
}
