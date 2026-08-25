export type ContextMessage = {
  body: string;
  kind?: string;
  senderMember?: { principalType?: string; user?: { displayName: string } | null; assistantKey?: string | null } | null;
};

export function buildChatContext(messages: ContextMessage[], systemPrompt = "你是聊天室助手“大聪明”。用简体中文简洁、清楚地回复，只根据当前房间上下文作答。") {
  return [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((message) => ({
      role: message.kind === "AI" || message.senderMember?.principalType === "ASSISTANT" ? "assistant" as const : "user" as const,
      content: message.body,
    })),
  ];
}

export function maskSecret(secret: string | null | undefined) {
  if (!secret) return null;
  return "********";
}
