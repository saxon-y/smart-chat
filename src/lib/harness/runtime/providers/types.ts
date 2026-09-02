import type { ContentPart, Usage } from "../../protocol";

export type ModelRequest = {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string }>;
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  stream?: boolean;
  maxOutputTokens?: number;
};

export type ModelResponse = {
  id?: string;
  content: ContentPart[];
  toolCalls: Array<{ id: string; name: string; arguments: unknown }>;
  finishReason: string;
};

export type ModelEvent =
  | { type: "text.delta"; text: string }
  | { type: "tool.arguments.delta"; callId: string; name?: string; text: string }
  | { type: "response.completed"; response: ModelResponse; usage: Usage };

export interface ModelProvider {
  generate(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
