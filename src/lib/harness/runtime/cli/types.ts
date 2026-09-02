export type CliProvider = "codex" | "claude";

export type CliStreamEvent =
  | { type: "session.started"; sessionId: string }
  | { type: "assistant.delta"; text: string }
  | { type: "tool.started"; callId: string; toolId: string }
  | { type: "tool.completed"; callId: string; ok: boolean }
  | { type: "run.completed"; text: string };

export type CliSessionIdentity = {
  provider: CliProvider;
  sessionId: string;
};

export interface ChildProcessHandle {
  readonly pid?: number;
  readonly stdout: AsyncIterable<Uint8Array | string>;
  readonly stderr: AsyncIterable<Uint8Array | string>;
  readonly exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export type SpawnCliProcess = (
  executable: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; detached: true; shell: false },
) => ChildProcessHandle;

export type SignalProcessGroup = (pid: number, signal: NodeJS.Signals) => void;
