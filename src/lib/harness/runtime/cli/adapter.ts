import { resolve } from "node:path";
import { parseNdjsonStream, validateSessionId } from "./parser";
import { spawnCliProcess, terminateProcessGroup } from "./process";
import type { ChildProcessHandle, CliProvider, CliStreamEvent, SignalProcessGroup, SpawnCliProcess } from "./types";

export type CliAdapterOptions = {
  provider: CliProvider;
  executable: string;
  workspaceRoot: string;
  spawn?: SpawnCliProcess;
  signal?: SignalProcessGroup;
  graceMs?: number;
};

export class CliAdapter {
  readonly #processes = new Map<string, ChildProcessHandle>();
  readonly #spawn: SpawnCliProcess;

  constructor(private readonly options: CliAdapterOptions) {
    this.#spawn = options.spawn ?? spawnCliProcess;
  }

  execute(runId: string, prompt: string, relativeWorkspace: string, sessionId?: string): AsyncIterable<CliStreamEvent> {
    if (this.#processes.has(runId)) throw new Error(`Run ${runId} already has a CLI process`);
    const cwd = resolve(this.options.workspaceRoot, relativeWorkspace);
    const root = resolve(this.options.workspaceRoot);
    if (cwd !== root && !cwd.startsWith(`${root}/`)) throw new Error("CLI workspace escapes the configured root");
    const validSessionId = sessionId === undefined ? undefined : validateSessionId(sessionId);
    const args = this.options.provider === "codex"
      ? ["exec", "--json", ...(validSessionId ? ["resume", validSessionId] : []), prompt]
      : ["--print", "--output-format", "stream-json", ...(validSessionId ? ["--resume", validSessionId] : []), prompt];
    const child = this.#spawn(this.options.executable, args, { cwd, env: process.env, detached: true, shell: false });
    this.#processes.set(runId, child);
    void child.exit.finally(() => this.#processes.delete(runId)).catch(() => undefined);
    return parseNdjsonStream(this.options.provider, child.stdout);
  }

  async cancel(runId: string): Promise<void> {
    const child = this.#processes.get(runId);
    if (!child) return;
    await terminateProcessGroup(child, { graceMs: this.options.graceMs ?? 5_000, signal: this.options.signal });
    this.#processes.delete(runId);
  }

  hasActiveProcess(runId: string): boolean { return this.#processes.has(runId); }
}
