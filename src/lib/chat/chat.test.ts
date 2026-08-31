import { describe, expect, it } from "vitest";
import { extractMentionNames, validateMessageBody } from "./validation";

describe("chat message validation", () => {
  it("trims valid text and rejects blank or oversized input", () => {
    expect(validateMessageBody("  hello  ")).toEqual({ ok: true, body: "hello" });
    expect(validateMessageBody("   ").ok).toBe(false);
    expect(validateMessageBody("x".repeat(4001)).ok).toBe(false);
  });

  it("extracts mention tokens without treating email-like text as a mention", () => {
    expect(extractMentionNames("hi @大聪明 and @Maya_1")).toEqual(["大聪明", "Maya_1"]);
    expect(extractMentionNames("mail a@b.test")).toEqual([]);
  });

  it("extracts each assistant mention when multiple agents are addressed", () => {
    expect(extractMentionNames("@绘图师\n请和 @文案师 一起处理")).toEqual(["绘图师", "文案师"]);
  });

  it("does not treat an at-sign in the middle of a token as a mention", () => {
    expect(extractMentionNames("ticket#123@agent user@host.test foo@bar")).toEqual([]);
  });
});
