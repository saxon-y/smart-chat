import { ModelProviderType } from "@prisma/client";
import { assertSafeProviderUrl } from "./provider-security";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ProviderConfig = {
  baseUrl: string;
  modelId: string;
  timeoutMs: number;
  apiKey?: string;
  providerType: ModelProviderType;
};

type GeneratedImage = { bytes: Buffer; revisedPrompt?: string };

function openAiUrl(baseUrl: string, resource: "chat/completions" | "images/generations") {
  const base = baseUrl.replace(/\/$/, "");
  if (base.endsWith(`/${resource}`)) return base;
  if (/\/v\d+$/.test(base)) return `${base}/${resource}`;
  return `${base}/v1/${resource}`;
}

function geminiUrl(baseUrl: string, modelId: string, action?: "generateContent") {
  const base = baseUrl.replace(/\/$/, "");
  if (action && base.endsWith(":generateContent")) return base;
  const apiBase = /\/v\d+(?:beta\d*)?$/.test(base) ? base : `${base}/v1beta`;
  const modelUrl = `${apiBase}/models/${encodeURIComponent(modelId)}`;
  return action ? `${modelUrl}:${action}` : modelUrl;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const safeUrl = await assertSafeProviderUrl(url);
    const response = await fetch(safeUrl.toString(), { ...init, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("provider_outcome_unknown");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function providerFetch(config: ProviderConfig, resource: "chat/completions" | "images/generations", body: unknown) {
  return fetchJson(openAiUrl(config.baseUrl, resource), {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify(body),
  }, config.timeoutMs);
}

export async function callChatProvider(config: ProviderConfig, messages: Array<unknown>) {
  const payload = await providerFetch(config, "chat/completions", { model: config.modelId, messages });
  const choices = payload.choices as Array<{ message?: { content?: string } }> | undefined;
  const usage = payload.usage as { total_tokens?: number } | undefined;
  const content = choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("provider_empty_response");
  return { content, tokenUsage: usage?.total_tokens };
}

async function fetchImageBytes(item: { b64_json?: string; url?: string }, sourceHost: string) {
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (!item.url) throw new Error("provider_empty_response");
  const url = await assertSafeProviderUrl(item.url, sourceHost);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`provider_image_http_${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error("provider_image_too_large");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("provider_image_too_large");
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

async function generateOpenAiImage(config: ProviderConfig, prompt: string, size: string): Promise<GeneratedImage> {
  const payload = await providerFetch(config, "images/generations", { model: config.modelId, prompt, size });
  const data = payload.data as Array<{ b64_json?: string; url?: string; revised_prompt?: string }> | undefined;
  const item = data?.[0];
  if (!item) throw new Error("provider_empty_response");
  return { bytes: await fetchImageBytes(item, new URL(config.baseUrl).hostname), revisedPrompt: item.revised_prompt };
}

async function generateGeminiImage(config: ProviderConfig, prompt: string, aspectRatio: string): Promise<GeneratedImage> {
  if (!config.apiKey) throw new Error("provider_api_key_missing");
  const payload = await fetchJson(geminiUrl(config.baseUrl, config.modelId, "generateContent"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
    }),
  }, Math.max(config.timeoutMs, 120_000));
  const candidates = payload.candidates as Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> | undefined;
  const image = candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data)?.inlineData;
  if (!image?.data) throw new Error("provider_empty_response");
  const bytes = Buffer.from(image.data, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("provider_image_too_large");
  return { bytes };
}

export function generateImage(config: ProviderConfig, prompt: string, size = "1024x1024", aspectRatio = "1:1"): Promise<GeneratedImage> {
  if (config.providerType === ModelProviderType.GEMINI_IMAGES) return generateGeminiImage(config, prompt, aspectRatio);
  return generateOpenAiImage(config, prompt, size);
}

export async function providerHealthRequest(config: ProviderConfig) {
  if (config.providerType === ModelProviderType.GEMINI_IMAGES) {
    if (!config.apiKey) throw new Error("provider_api_key_missing");
    return {
      url: (await assertSafeProviderUrl(geminiUrl(config.baseUrl, config.modelId))).toString(),
      headers: { "x-goog-api-key": config.apiKey } as Record<string, string>,
    };
  }
  const baseUrl = config.baseUrl.replace(/\/(?:chat\/completions|images\/generations)\/?$/, "").replace(/\/$/, "");
  return {
    url: (await assertSafeProviderUrl(`${baseUrl}/models`)).toString(),
    headers: (config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) as Record<string, string>,
  };
}
