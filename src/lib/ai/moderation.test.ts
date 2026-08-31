import { afterEach, describe, expect, it } from "vitest";
import { moderateImagePrompt } from "./moderation";

const original = process.env.IMAGE_PROMPT_BLOCKLIST;
afterEach(() => { if (original === undefined) delete process.env.IMAGE_PROMPT_BLOCKLIST; else process.env.IMAGE_PROMPT_BLOCKLIST = original; });

describe("image prompt moderation", () => {
  it("allows ordinary prompts", () => expect(moderateImagePrompt("雨后的城市夜景")).toEqual({ allowed: true }));
  it("rejects control characters and configured terms", () => {
    expect(moderateImagePrompt("hello\u0000world")).toEqual({ allowed: false, reasonCode: "PROMPT_CONTROL_CHARACTERS" });
    process.env.IMAGE_PROMPT_BLOCKLIST = "blocked phrase";
    expect(moderateImagePrompt("a BLOCKED PHRASE here")).toEqual({ allowed: false, reasonCode: "PROMPT_BLOCKED_TERM" });
  });
});
