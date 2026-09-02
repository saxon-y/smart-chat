import { buildSupervisorPrompt, validateRoutingDecision, type RoutingCandidate } from "@/lib/ai/routing";
import { HarnessRuntimeError, type RunEvent, type RunResult, type TaskEnvelope, type Usage } from "../../protocol";
import type { AgentRuntime, RuntimeCapabilities, RuntimeSession } from "../types";

export type SupervisorModelPort = {
  route(input: { task: TaskEnvelope; prompt: string; signal: AbortSignal }): Promise<{ content: string; usage?: Usage }>;
};

export type ChildDispatchRequest = {
  idempotencyKey: string;
  parentRunId: string;
  roomId: string;
  triggerMessageId: string;
  targetMemberId: string;
  agentKey: string;
  capability: string;
};

export type ChildDispatchPort = {
  enqueue(request: ChildDispatchRequest): Promise<{ childRunId: string; created: boolean }>;
};

type SupervisorSnapshot = { candidates?: RoutingCandidate[]; confidenceThreshold?: number };

function completed(decision: Record<string, unknown>, usage: Usage = { inputTokens: 0, outputTokens: 0 }): RunResult {
  return { status: "COMPLETED", output: [{ type: "json", value: decision }], summary: String(decision.reasonCode ?? decision.action), artifacts: [], decisions: [decision], followups: [], usage, continuity: "FULL" };
}

function eventsFor(result: Promise<RunResult>): AsyncIterable<RunEvent> {
  return (async function* () {
    yield { sequence: 0, type: "run.started" };
    try { yield { sequence: 1, type: "run.completed", result: await result }; }
    catch (error) {
      const runtimeError = error instanceof HarnessRuntimeError ? error : undefined;
      yield { sequence: 1, type: "run.failed", code: runtimeError?.code ?? "supervisor_runtime_failed", retryable: runtimeError?.retryable ?? false };
    }
  })();
}

export class EmbeddedSupervisorRuntime implements AgentRuntime {
  readonly id = "embedded-supervisor";
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly model: SupervisorModelPort, private readonly dispatcher: ChildDispatchPort) {}

  async capabilities(): Promise<RuntimeCapabilities> {
    return { tools: false, streaming: false, resume: true, modalities: ["text"], capabilities: ["supervisor-routing", "child-dispatch"] };
  }

  async execute(task: TaskEnvelope): Promise<RuntimeSession> {
    const controller = new AbortController();
    this.controllers.set(task.runId, controller);
    const result = this.run(task, controller.signal).finally(() => this.controllers.delete(task.runId));
    return { result, events: eventsFor(result) };
  }

  resume(task: TaskEnvelope) { return this.execute(task); }

  async cancel(runId: string) { this.controllers.get(runId)?.abort(); }

  private async run(task: TaskEnvelope, signal: AbortSignal): Promise<RunResult> {
    const snapshot = task.agent as SupervisorSnapshot;
    const candidates = snapshot.candidates ?? [];
    if (!candidates.length) return completed({ action: "NO_ACTION", confidence: 0, reasonCode: "NO_CANDIDATES" });
    const threshold = snapshot.confidenceThreshold ?? 0.75;
    const response = await this.model.route({ task, prompt: buildSupervisorPrompt(candidates, threshold), signal });
    const decision = validateRoutingDecision(response.content, candidates, threshold);
    if (decision.action === "NO_ACTION") return completed(decision, response.usage);
    const candidate = candidates.find(({ memberId }) => memberId === decision.targetMemberId);
    if (!candidate) throw new HarnessRuntimeError("invalid_routing_target", "RUNTIME", false, true);
    const dispatch = await this.dispatcher.enqueue({
      idempotencyKey: `${task.runId}:${decision.targetMemberId}`,
      parentRunId: task.runId,
      roomId: task.roomId,
      triggerMessageId: task.triggerMessageId,
      targetMemberId: decision.targetMemberId,
      agentKey: candidate.agentKey,
      capability: decision.capability,
    });
    return completed({ ...decision, childRunId: dispatch.childRunId, childCreated: dispatch.created }, response.usage);
  }
}
