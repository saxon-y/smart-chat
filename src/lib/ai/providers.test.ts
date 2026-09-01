import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callChatProvider, generateImage, providerHealthRequest } from "./providers";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]) }));

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const config = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  modelId: "gemini-2.5-flash-image",
  timeoutMs: 30_000,
  apiKey: "gemini-secret",
  providerType: "GEMINI_IMAGES" as const,
};

const originalAllowlist = process.env.AI_PROVIDER_HOST_ALLOWLIST;

beforeEach(() => { process.env.AI_PROVIDER_HOST_ALLOWLIST = "generativelanguage.googleapis.com"; });
afterEach(() => {
  vi.restoreAllMocks();
  if (originalAllowlist === undefined) delete process.env.AI_PROVIDER_HOST_ALLOWLIST;
  else process.env.AI_PROVIDER_HOST_ALLOWLIST = originalAllowlist;
});

describe("Gemini image provider", () => {
  it("calls generateContent with the configured model, key, and aspect ratio", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await generateImage(config, "画一只猫", "1536x1024", "16:9");

    expect(result.bytes).toEqual(png);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
    expect(init?.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "gemini-secret" });
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [{ parts: [{ text: "画一只猫" }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    });
  });

  it("rejects a successful response without image data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "No image" }] } }],
    }), { status: 200 }));

    await expect(generateImage(config, "test")).rejects.toThrow("provider_empty_response");
  });

  it("builds a Gemini model health request without exposing the key in the URL", async () => {
    await expect(providerHealthRequest(config)).resolves.toEqual({
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image",
      headers: { "x-goog-api-key": "gemini-secret" },
    });
  });

  it("uses the extended image timeout for slow Gemini generation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }],
    }), { status: 200 }));
    await generateImage({ ...config, timeoutMs: 30_000 }, "slow render");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("OpenAI image provider", () => {
  it("preserves the images/generations request and base64 response contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: png.toString("base64"), revised_prompt: "revised" }],
    }), { status: 200 }));

    const result = await generateImage({
      ...config,
      baseUrl: "https://generativelanguage.googleapis.com/v1",
      modelId: "gpt-image-1",
      providerType: "OPENAI_IMAGES",
    }, "draw", "1536x1024");

    expect(result).toEqual({ bytes: png, revisedPrompt: "revised" });
    expect(fetchMock).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/v1/images/generations", expect.objectContaining({
      body: JSON.stringify({ model: "gpt-image-1", prompt: "draw", size: "1536x1024" }),
    }));
  });
});

describe("OpenAI-compatible chat provider", () => {
  it("preserves the chat completion request, content, and usage contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "  hello  " } }],
      usage: { total_tokens: 17 },
    }), { status: 200 }));

    const result = await callChatProvider({
      ...config,
      baseUrl: "https://generativelanguage.googleapis.com/v1",
      modelId: "chat-model",
      providerType: "OPENAI_COMPATIBLE",
    }, [{ role: "user", content: "hi" }]);

    expect(result).toEqual({ content: "hello", tokenUsage: 17 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1/chat/completions",
      expect.objectContaining({
        body: JSON.stringify({ model: "chat-model", messages: [{ role: "user", content: "hi" }] }),
      }),
    );
  });

  it("classifies provider failures and empty responses", async () => {
    const chatConfig = { ...config, providerType: "OPENAI_COMPATIBLE" as const };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("busy", { status: 429 }));
    await expect(callChatProvider(chatConfig, [])).rejects.toThrow("provider_http_429");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(callChatProvider(chatConfig, [])).rejects.toThrow("provider_empty_response");
  });
});
