import { z } from "zod";
import type { CliProvider, CliStreamEvent } from "./types";

const sessionIdSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export function validateSessionId(value: unknown): string {
  return sessionIdSchema.parse(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseCliEvent(provider: CliProvider, input: unknown): CliStreamEvent | undefined {
  if (!input || typeof input !== "object") return undefined;
  const event = input as Record<string, unknown>;

  if (provider === "codex") {
    if (event.type === "thread.started") return { type: "session.started", sessionId: validateSessionId(event.thread_id) };
    if (event.type === "item.updated" && event.item && typeof event.item === "object") {
      const item = event.item as Record<string, unknown>;
      const delta = text(item.text) ?? text(item.delta);
      if (item.type === "agent_message" && delta) return { type: "assistant.delta", text: delta };
    }
    if (event.type === "turn.completed") return { type: "run.completed", text: text(event.result) ?? "" };
  } else {
    if (event.type === "system" && event.subtype === "init") return { type: "session.started", sessionId: validateSessionId(event.session_id) };
    if (event.type === "assistant" && event.message && typeof event.message === "object") {
      const message = event.message as Record<string, unknown>;
      if (Array.isArray(message.content)) {
        const value = message.content.find((part) => part && typeof part === "object" && (part as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
        const valueText = text(value?.text);
        if (valueText) return { type: "assistant.delta", text: valueText };
      }
    }
    if (event.type === "result") return { type: "run.completed", text: text(event.result) ?? "" };
  }

  return undefined;
}

export async function* parseNdjsonStream(provider: CliProvider, stream: AsyncIterable<Uint8Array | string>): AsyncIterable<CliStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseCliEvent(provider, JSON.parse(line) as unknown);
      if (parsed) yield parsed;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const parsed = parseCliEvent(provider, JSON.parse(buffer) as unknown);
    if (parsed) yield parsed;
  }
}
