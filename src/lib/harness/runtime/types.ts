import type { RunEvent, RunResult, TaskEnvelope } from "../protocol";

export type RuntimeCapabilities = {
  tools: boolean;
  streaming: boolean;
  resume: boolean;
  modalities: Array<"text" | "image">;
  capabilities: string[];
};

export type RuntimeSession = {
  events: AsyncIterable<RunEvent>;
  result: Promise<RunResult>;
};

export interface AgentRuntime {
  readonly id: string;
  capabilities(): Promise<RuntimeCapabilities>;
  execute(task: TaskEnvelope): Promise<RuntimeSession>;
  resume(task: TaskEnvelope): Promise<RuntimeSession>;
  cancel(runId: string): Promise<void>;
}
