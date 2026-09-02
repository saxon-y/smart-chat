import { canonicalJson, sha256Digest, type ContentPart, type RunResult, type Usage } from "../../protocol";
import { DeltaAggregator } from "./delta-aggregator";
import type {
  AgentLoopOptions, AgentLoopOutcome, AgentLoopPorts, AgentLoopState, CompletedTurn,
  LoopSnapshot, ToolExecutionResult, ToolRequest,
} from "./types";

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...((left.costMicros !== undefined || right.costMicros !== undefined)
      ? { costMicros: (left.costMicros ?? 0) + (right.costMicros ?? 0) }
      : {}),
  };
}

function textOf(content: ContentPart[]) {
  return content.filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text").map((part) => part.text).join("");
}

function terminal(status: RunResult["status"], snapshot: LoopSnapshot, summary: string, output: ContentPart[] = []): RunResult {
  return { status, output, summary, artifacts: [], decisions: [], followups: [], usage: snapshot.usage, continuity: "FULL" };
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error("run_cancelled");
}

export class AgentLoop {
  constructor(private readonly ports: AgentLoopPorts, private readonly options: AgentLoopOptions = {}) {}

  async run(task: LoopSnapshot["task"], signal: AbortSignal): Promise<AgentLoopOutcome> {
    const states: AgentLoopState[] = [];
    const transitionLimit = this.options.maxStateTransitions ?? Math.max(32, task.limits.maxTurns * 8 + task.limits.maxToolCalls * 4);
    let transitions = 0;
    let snapshot!: LoopSnapshot;
    const startedAt = (this.ports.now ?? Date.now)();
    const observer = this.options.observer;
    observer?.logger.log("info", "run.started", { runId: task.runId, roomId: task.roomId });

    const enter = (state: AgentLoopState) => {
      states.push(state);
      transitions += 1;
      if (state !== "FINALIZE" && transitions > transitionLimit) throw new Error("agent_loop_transition_limit_exceeded");
    };
    const cancelled = async () => signal.aborted || await this.ports.isCancellationRequested?.(task.runId) === true;
    const finish = async (result: RunResult): Promise<AgentLoopOutcome> => {
      enter("FINALIZE");
      await this.ports.finalize(result, snapshot);
      await observer?.latency("run_latency_ms", (this.ports.now ?? Date.now)() - startedAt, task.runId);
      await observer?.usage(task.runId, snapshot.usage);
      observer?.logger.log(result.status === "FAILED" ? "error" : "info", "run.finalized", { runId: task.runId, roomId: task.roomId }, { status: result.status, summary: result.summary });
      return { result, snapshot, states };
    };

    try {
      enter("LOAD");
      snapshot = await this.ports.load(task, signal);

      while (true) {
        if (await cancelled()) return finish(terminal("CANCELLED", snapshot, "run_cancelled"));
        const now = (this.ports.now ?? Date.now)();
        if (now - startedAt >= task.limits.maxWallTimeMs) return finish(terminal("FAILED", snapshot, "wall_time_limit_exceeded"));
        if (snapshot.turnCount >= task.limits.maxTurns) return finish(terminal("FAILED", snapshot, "turn_limit_exceeded"));
        if (snapshot.usage.inputTokens >= task.limits.maxInputTokens) return finish(terminal("FAILED", snapshot, "input_token_limit_exceeded"));
        if (snapshot.usage.outputTokens >= task.limits.maxOutputTokens) return finish(terminal("FAILED", snapshot, "output_token_limit_exceeded"));

        enter("BUILD_INPUT");
        const built = await this.ports.buildInput(snapshot, signal);
        const expectedDigest = sha256Digest(JSON.parse(canonicalJson(built.request)));
        if (built.inputDigest !== expectedDigest) throw new Error("input_digest_mismatch");

        enter("MODEL");
        const turnStartedAt = (this.ports.now ?? Date.now)();
        let firstTokenRecorded = false;
        let completed: CompletedTurn | undefined;
        const batches: string[] = [];
        const deltas = new DeltaAggregator(async (batch) => {
          batches.push(batch.text);
          await this.ports.persistDelta?.(batch, signal);
        }, { maxBytes: this.options.deltaMaxBytes, maxDelayMs: this.options.deltaMaxDelayMs });

        try {
          for await (const event of this.ports.provider.generate(built.request, signal)) {
            if (await cancelled()) throw abortReason(signal);
            if (event.type === "text.delta") {
              if (!firstTokenRecorded) {
                firstTokenRecorded = true;
                await observer?.latency("first_token_latency_ms", (this.ports.now ?? Date.now)() - turnStartedAt, task.runId, { turnIndex: snapshot.turnCount + 1 });
              }
              await deltas.push(event.text, (this.ports.now ?? Date.now)());
            }
            if (event.type === "response.completed") {
              await deltas.flush();
              completed = {
                number: snapshot.turnCount + 1,
                inputDigest: built.inputDigest,
                request: built.request,
                response: event.response,
                usage: event.usage,
              };
            }
          }
        } catch (error) {
          deltas.discard();
          if (await cancelled() || signal.aborted) return finish(terminal("CANCELLED", snapshot, "run_cancelled"));
          throw error;
        }

        if (!completed) throw new Error("model_response_incomplete");
        const streamedText = batches.join("");
        const finalText = textOf(completed.response.content);
        if (streamedText && streamedText !== finalText) throw new Error("model_delta_response_mismatch");

        // A response becomes durable atomically; streamed deltas alone never constitute a Turn.
        await this.ports.commitTurn(completed, signal);
        await observer?.latency("turn_latency_ms", (this.ports.now ?? Date.now)() - turnStartedAt, task.runId, { turnIndex: completed.number });
        await observer?.usage(task.runId, completed.usage, completed.number);
        snapshot = { ...snapshot, turnCount: snapshot.turnCount + 1, usage: addUsage(snapshot.usage, completed.usage) };

        enter("CHECK_LIMITS");
        if (snapshot.usage.inputTokens > task.limits.maxInputTokens) return finish(terminal("FAILED", snapshot, "input_token_limit_exceeded"));
        if (snapshot.usage.outputTokens > task.limits.maxOutputTokens) return finish(terminal("FAILED", snapshot, "output_token_limit_exceeded"));
        if (task.limits.maxCostMicros !== undefined && (snapshot.usage.costMicros ?? 0) > task.limits.maxCostMicros) {
          return finish(terminal("FAILED", snapshot, "cost_limit_exceeded"));
        }
        if (completed.response.finishReason === "length") return finish(terminal("FAILED", snapshot, "model_length_limit", completed.response.content));

        const calls = completed.response.toolCalls;
        if (calls.length === 0) {
          enter("CHECKPOINT");
          await this.ports.checkpoint(snapshot, signal);
          return finish(terminal("COMPLETED", snapshot, finalText, completed.response.content));
        }
        if (snapshot.toolCallCount + calls.length > task.limits.maxToolCalls) {
          return finish(terminal("FAILED", snapshot, "tool_call_limit_exceeded"));
        }

        const requests: ToolRequest[] = calls.map((call) => ({ callId: call.id, name: call.name, arguments: call.arguments }));
        enter("AUTHORIZE");
        for (const request of requests) {
          const authorization = await this.ports.authorize(request, snapshot, signal);
          if (authorization.decision === "DENY") return finish(terminal("FAILED", snapshot, authorization.reason));
          if (authorization.decision === "REQUIRE_APPROVAL") {
            return finish(terminal("BLOCKED", snapshot, authorization.reason));
          }
        }

        enter("TOOLS");
        const results: ToolExecutionResult[] = [];
        for (const request of requests) {
          if (await cancelled()) return finish(terminal("CANCELLED", snapshot, "run_cancelled"));
          const toolStartedAt = (this.ports.now ?? Date.now)();
          results.push(await this.ports.executeTool(request, snapshot, signal));
          await observer?.latency("tool_latency_ms", (this.ports.now ?? Date.now)() - toolStartedAt, task.runId, { turnIndex: completed.number, toolCallId: request.callId });
          snapshot = { ...snapshot, toolCallCount: snapshot.toolCallCount + 1 };
        }

        enter("APPEND");
        for (const result of results) await this.ports.appendToolResult(result, snapshot, signal);
        enter("CHECKPOINT");
        await this.ports.checkpoint(snapshot, signal);
        const failedTool = results.find((result) => !result.ok);
        if (failedTool) return finish(terminal("FAILED", snapshot, `tool_failed:${failedTool.toolId}`));
      }
    } catch (error) {
      if (!snapshot) throw error;
      const summary = error instanceof Error ? error.message : "agent_loop_failed";
      return finish(terminal(signal.aborted ? "CANCELLED" : "FAILED", snapshot, summary));
    }
  }
}
