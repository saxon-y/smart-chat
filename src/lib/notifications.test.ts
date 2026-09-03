import { describe, expect, it } from "vitest";
import { compactSummary } from "./notifications";

describe("notifications", () => {
  it("compacts whitespace and bounds summaries", () => {
    expect(compactSummary("  hello\n world  ")).toBe("hello world");
    expect(compactSummary("x".repeat(300))).toHaveLength(240);
  });
});
