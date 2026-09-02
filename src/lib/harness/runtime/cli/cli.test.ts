import { describe, expect, it, vi } from "vitest";
import { CliAdapter } from "./adapter";
import { parseNdjsonStream, validateSessionId } from "./parser";
import { terminateProcessGroup } from "./process";
import type { ChildProcessHandle } from "./types";

async function* chunks(...values: string[]) { for (const value of values) yield value; }

describe("CLI runtime adapters", () => {
  it("parses fragmented Codex and Claude stream events", async () => {
    const codex = [];
    for await (const event of parseNdjsonStream("codex", chunks('{"type":"thread.started",', '"thread_id":"thread-1"}\n{"type":"turn.completed","result":"done"}\n'))) codex.push(event);
    expect(codex).toEqual([{ type: "session.started", sessionId: "thread-1" }, { type: "run.completed", text: "done" }]);

    const claude = [];
    for await (const event of parseNdjsonStream("claude", chunks('{"type":"system","subtype":"init","session_id":"session:1"}\n'))) claude.push(event);
    expect(claude).toEqual([{ type: "session.started", sessionId: "session:1" }]);
  });

  it("rejects invalid session identities", () => {
    expect(() => validateSessionId("../escape")).toThrow();
    expect(() => validateSessionId("")).toThrow();
  });

  it("builds provider-specific commands without a shell", () => {
    let observed: unknown;
    const child: ChildProcessHandle = { pid: 42, stdout: chunks(), stderr: chunks(), exit: new Promise(() => undefined) };
    const adapter = new CliAdapter({ provider: "claude", executable: "claude", workspaceRoot: "/work", spawn: (executable, args, options) => {
      observed = { executable, args, options };
      return child;
    } });
    adapter.execute("run-1", "hello", "run-1", "session-1");
    expect(observed).toMatchObject({ executable: "claude", args: ["--print", "--output-format", "stream-json", "--resume", "session-1", "hello"], options: { shell: false, detached: true, cwd: "/work/run-1" } });
    expect(() => adapter.execute("run-2", "hello", "../escape")).toThrow("escapes");
  });

  it("escalates cancellation from SIGTERM to SIGKILL and leaves no tracked process", async () => {
    vi.useFakeTimers();
    let resolveExit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolveExit = resolve; });
    const signals: NodeJS.Signals[] = [];
    const terminating = terminateProcessGroup({ pid: 99, exit }, { graceMs: 10, signal: (_pid, signal) => {
      signals.push(signal);
      if (signal === "SIGKILL") resolveExit({ code: null, signal });
    } });
    await vi.advanceTimersByTimeAsync(10);
    await terminating;
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    vi.useRealTimers();
  });

  it("removes a cancelled process from the adapter registry", async () => {
    let resolveExit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
    const child: ChildProcessHandle = {
      pid: 101,
      stdout: chunks(),
      stderr: chunks(),
      exit: new Promise((resolve) => { resolveExit = resolve; }),
    };
    const adapter = new CliAdapter({
      provider: "codex",
      executable: "codex",
      workspaceRoot: "/work",
      spawn: () => child,
      signal: (_pid, signal) => resolveExit({ code: null, signal }),
    });
    adapter.execute("run-1", "hello", "run-1");
    expect(adapter.hasActiveProcess("run-1")).toBe(true);
    await adapter.cancel("run-1");
    expect(adapter.hasActiveProcess("run-1")).toBe(false);
  });
});
