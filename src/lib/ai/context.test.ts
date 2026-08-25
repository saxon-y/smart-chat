import { describe, expect, it } from "vitest";
import { buildChatContext, maskSecret } from "./context";

describe("AI context", () => {
  it("keeps only ordered chat messages and maps assistant messages", () => {
    expect(buildChatContext([
      { body: "hello" },
      { body: "hi", kind: "AI" },
    ])).toEqual([
      { role: "system", content: "你是聊天室助手“大聪明”。用简体中文简洁、清楚地回复，只根据当前房间上下文作答。" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("never exposes a secret", () => {
    expect(maskSecret("super-secret")).toBe("********");
    expect(maskSecret(null)).toBeNull();
  });
});
