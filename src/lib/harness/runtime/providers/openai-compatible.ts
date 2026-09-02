import { assertSafeProviderUrl } from "@/lib/ai/provider-security";
import { HarnessRuntimeError } from "../../protocol";
import type { ModelEvent, ModelProvider, ModelRequest, ModelResponse } from "./types";

type OpenAiToolCall = { id?: string; index?: number; function?: { name?: string; arguments?: string } };
type OpenAiChoice = { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }; delta?: { content?: string; tool_calls?: OpenAiToolCall[] }; finish_reason?: string | null };
type OpenAiPayload = { id?: string; choices?: OpenAiChoice[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
};

function endpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function requestBody(request: ModelRequest) {
  return {
    model: request.model,
    messages: request.messages.map(({ toolCallId, ...message }) => ({ ...message, ...(toolCallId ? { tool_call_id: toolCallId } : {}) })),
    ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) } : {}),
    ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
    stream: request.stream ?? true,
    ...((request.stream ?? true) ? { stream_options: { include_usage: true } } : {}),
  };
}

function usage(payload: OpenAiPayload) {
  return { inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0 };
}

function completedResponse(payload: OpenAiPayload): ModelResponse {
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  return {
    id: payload.id,
    content: content ? [{ type: "text", text: content }] : [],
    toolCalls: (choice?.message?.tool_calls ?? []).map((call) => ({
      id: call.id ?? `tool-${call.index ?? 0}`,
      name: call.function?.name ?? "",
      arguments: parseArguments(call.function?.arguments ?? "{}"),
    })),
    finishReason: choice?.finish_reason ?? "stop",
  };
}

function parseArguments(value: string) {
  try { return JSON.parse(value) as unknown; } catch { throw new HarnessRuntimeError("provider_invalid_tool_arguments", "PROVIDER", false, true); }
}

export class OpenAiCompatibleProvider implements ModelProvider {
  constructor(private readonly config: OpenAiCompatibleConfig) {}

  async *generate(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const timeout = AbortSignal.timeout(Math.max(1_000, this.config.timeoutMs));
    const combined = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      const url = await assertSafeProviderUrl(endpoint(this.config.baseUrl));
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}) },
        body: JSON.stringify(requestBody(request)),
        signal: combined,
        cache: "no-store",
      });
    } catch {
      if (combined.aborted) throw new HarnessRuntimeError("provider_outcome_unknown", "PROVIDER", false, false, "REBUILT");
      throw new HarnessRuntimeError("provider_connection_failed", "PROVIDER", true, true);
    }
    if (!response.ok) throw new HarnessRuntimeError(`provider_http_${response.status}`, "PROVIDER", response.status === 429 || response.status >= 500, true);

    if (!(request.stream ?? true)) {
      const payload = await response.json() as OpenAiPayload;
      yield { type: "response.completed", response: completedResponse(payload), usage: usage(payload) };
      return;
    }
    if (!response.body) throw new HarnessRuntimeError("provider_empty_response", "PROVIDER", false, true);

    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let text = "";
    let responseId: string | undefined;
    let finishReason = "stop";
    let finalUsage = { inputTokens: 0, outputTokens: 0 };
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = response.body.getReader();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data) as OpenAiPayload;
        responseId ??= payload.id;
        finalUsage = usage(payload);
        const choice = payload.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (choice?.delta?.content) {
          text += choice.delta.content;
          yield { type: "text.delta", text: choice.delta.content };
        }
        for (const call of choice?.delta?.tool_calls ?? []) {
          const index = call.index ?? 0;
          const current = toolCalls.get(index) ?? { id: call.id ?? `tool-${index}`, name: "", arguments: "" };
          if (call.id) current.id = call.id;
          if (call.function?.name) current.name = call.function.name;
          if (call.function?.arguments) {
            current.arguments += call.function.arguments;
            yield { type: "tool.arguments.delta", callId: current.id, name: current.name || undefined, text: call.function.arguments };
          }
          toolCalls.set(index, current);
        }
      }
    }
    yield {
      type: "response.completed",
      response: {
        id: responseId,
        content: text ? [{ type: "text", text }] : [],
        toolCalls: [...toolCalls.values()].map((call) => ({ id: call.id, name: call.name, arguments: parseArguments(call.arguments) })),
        finishReason,
      },
      usage: finalUsage,
    };
  }
}
