import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getWechatEmoji, WECHAT_EMOJI } from "./wechat-emoji";

describe("wechat emoji catalog", () => {
  it("exposes unique WeChat codes and a lookup for known tokens", () => {
    expect(WECHAT_EMOJI).toHaveLength(109);
    expect(new Set(WECHAT_EMOJI.map((emoji) => emoji.code)).size).toBe(109);
    expect(getWechatEmoji("[微笑]")?.name).toBe("微笑");
    expect(getWechatEmoji("[666]")?.src).toBe(encodeURI("/wechat-emoji/face/666.png"));
    expect(getWechatEmoji("[不存在]")).toBeUndefined();
  });

  it("points every sticker at a local public asset", () => {
    const publicRoot = join(process.cwd(), "public");
    for (const emoji of WECHAT_EMOJI) {
      const relative = decodeURI(emoji.src).replace(/^\//, "");
      expect(existsSync(join(publicRoot, relative)), emoji.src).toBe(true);
    }
  });
});
