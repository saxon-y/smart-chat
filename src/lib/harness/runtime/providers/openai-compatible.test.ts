import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider } from "./openai-compatible";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]) }));
const previousAllowlist = process.env.AI_PROVIDER_HOST_ALLOWLIST;

async function collect(provider: OpenAiCompatibleProvider, stream = true) {
  const events = [];
  for await (const event of provider.generate({ model: "test", messages: [{ role: "user", content: "hi" }], stream }, new AbortController().signal)) events.push(event);
  return events;
}

beforeEach(() => { process.env.AI_PROVIDER_HOST_ALLOWLIST = "provider.example"; });
afterEach(() => {
  vi.restoreAllMocks();
  if (previousAllowlist === undefined) delete process.env.AI_PROVIDER_HOST_ALLOWLIST;
  else process.env.AI_PROVIDER_HOST_ALLOWLIST = previousAllowlist;
});

describe("OpenAiCompatibleProvider", () => {
  it("normalizes a non-streaming completion", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "r1", choices: [{ message: { content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3 } }), { status: 200 }));
    const events = await collect(new OpenAiCompatibleProvider({ baseUrl: "https://provider.example/v1", timeoutMs: 10_000 }), false);
    expect(events).toEqual([{ type: "response.completed", response: { id: "r1", content: [{ type: "text", text: "hello" }], toolCalls: [], finishReason: "stop" }, usage: { inputTokens: 2, outputTokens: 3 } }]);
  });

  it("assembles streaming text, tool arguments, finish reason, and usage", async () => {
    const sse = [
      'data: {"id":"r1","choices":[{"delta":{"content":"Hi "}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"lookup","arguments":"{\\"id\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":5}}',
      "data: [DONE]",
    ].join("\n\n") + "\n\n";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const events = await collect(new OpenAiCompatibleProvider({ baseUrl: "https://provider.example/v1", timeoutMs: 10_000 }));
    expect(events.at(-1)).toEqual({ type: "response.completed", response: { id: "r1", content: [{ type: "text", text: "Hi " }], toolCalls: [{ id: "c1", name: "lookup", arguments: { id: 1 } }], finishReason: "tool_calls" }, usage: { inputTokens: 4, outputTokens: 5 } });
  });

  it("classifies retryable HTTP failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 503 }));
    await expect(collect(new OpenAiCompatibleProvider({ baseUrl: "https://provider.example/v1", timeoutMs: 10_000 }))).rejects.toMatchObject({ code: "provider_http_503", retryable: true });
  });

  it("propagates cancellation to fetch and reports an unknown provider outcome", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation((_, init) => new Promise((_, reject) => {
      if (init?.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
      else init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const provider = new OpenAiCompatibleProvider({ baseUrl: "https://provider.example/v1", timeoutMs: 10_000 });
    const consuming = (async () => {
      for await (const event of provider.generate({ model: "test", messages: [], stream: true }, controller.signal)) void event;
    })();

    controller.abort();

    await expect(consuming).rejects.toMatchObject({ code: "provider_outcome_unknown", outcomeKnown: false });
  });
});
