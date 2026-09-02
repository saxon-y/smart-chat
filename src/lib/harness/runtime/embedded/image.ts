import { randomUUID } from "node:crypto";
import { moderateImagePrompt, type ModerationResult } from "@/lib/ai/moderation";
import { HarnessRuntimeError, type RunEvent, type RunResult, type TaskEnvelope } from "../../protocol";
import type { AgentRuntime, RuntimeCapabilities, RuntimeSession } from "../types";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ImageGenerationRequest = {
  task: TaskEnvelope;
  prompt: string;
  size: string;
  aspectRatio: string;
  signal: AbortSignal;
};

export type ImageGenerationResult = { bytes: Uint8Array; revisedPrompt?: string };

export interface EmbeddedImageGenerator {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

export interface EmbeddedArtifactStore {
  put(objectKey: string, bytes: Uint8Array): Promise<{ objectKey: string; sha256: string; byteSize: number }>;
  delete(objectKey: string): Promise<void>;
}

export type ArtifactRegistration = {
  runId: string;
  objectKey: string;
  mimeType: "image/png" | "image/jpeg";
  sha256: string;
  byteSize: number;
  revisedPrompt?: string;
};

export interface EmbeddedArtifactRepository {
  register(input: ArtifactRegistration): Promise<{ id: string }>;
}

export type EmbeddedImageRuntimeOptions = {
  generator: EmbeddedImageGenerator;
  artifactStore: EmbeddedArtifactStore;
  artifactRepository: EmbeddedArtifactRepository;
  moderate?: (prompt: string) => ModerationResult;
  createObjectKey?: (extension: "png" | "jpg") => string;
};

type ImageAgentSnapshot = {
  systemPrompt?: string;
  providerType?: string;
  image?: { style?: string; size?: string; aspect?: string };
};

function imageConfig(task: TaskEnvelope) {
  const agent = task.agent as ImageAgentSnapshot;
  const style = agent.image?.style && agent.image.style !== "auto" ? `\n风格：${agent.image.style}` : "";
  const prompt = `${agent.systemPrompt ?? ""}\n\n用户要求：${task.objective}${style}`.trim();
  const requestedAspect = agent.image?.aspect ?? "1:1";
  const aspectRatio = agent.providerType === "GEMINI_IMAGES"
    ? ({ "1:1": "1:1", "3:2": "4:3", "2:3": "3:4" }[requestedAspect] ?? "1:1")
    : requestedAspect;
  return { prompt, size: agent.image?.size ?? "1024x1024", aspectRatio };
}

function inspectImage(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HarnessRuntimeError("provider_image_too_large", "PROVIDER", false, true);
  const buffer = Buffer.from(bytes);
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
  if (!png && !jpeg) throw new HarnessRuntimeError("provider_invalid_image", "PROVIDER", false, true);
  return png
    ? { extension: "png" as const, mimeType: "image/png" as const }
    : { extension: "jpg" as const, mimeType: "image/jpeg" as const };
}

function eventsFor(result: Promise<RunResult>): AsyncIterable<RunEvent> {
  return (async function* () {
    yield { sequence: 0, type: "run.started" };
    try {
      yield { sequence: 1, type: "run.completed", result: await result };
    } catch (error) {
      const runtimeError = error instanceof HarnessRuntimeError ? error : undefined;
      yield { sequence: 1, type: "run.failed", code: runtimeError?.code ?? "image_runtime_failed", retryable: runtimeError?.retryable ?? false };
    }
  })();
}

export class EmbeddedImageRuntime implements AgentRuntime {
  readonly id = "embedded-image";
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly options: EmbeddedImageRuntimeOptions) {}

  async capabilities(): Promise<RuntimeCapabilities> {
    return { tools: false, streaming: false, resume: true, modalities: ["image"], capabilities: ["image-generation", "artifact-output"] };
  }

  async execute(task: TaskEnvelope): Promise<RuntimeSession> {
    const controller = new AbortController();
    this.controllers.set(task.runId, controller);
    const result = this.run(task, controller.signal).finally(() => this.controllers.delete(task.runId));
    return { result, events: eventsFor(result) };
  }

  resume(task: TaskEnvelope) { return this.execute(task); }

  async cancel(runId: string) { this.controllers.get(runId)?.abort(); }

  private async run(task: TaskEnvelope, signal: AbortSignal): Promise<RunResult> {
    const config = imageConfig(task);
    const moderation = (this.options.moderate ?? moderateImagePrompt)(config.prompt);
    if (!moderation.allowed) throw new HarnessRuntimeError(moderation.reasonCode.toLowerCase(), "POLICY", false, true);
    const generated = await this.options.generator.generate({ task, ...config, signal });
    const format = inspectImage(generated.bytes);
    const objectKey = (this.options.createObjectKey ?? ((extension) => `generated/${randomUUID()}.${extension}`))(format.extension);
    const stored = await this.options.artifactStore.put(objectKey, generated.bytes);
    let artifact: { id: string };
    try {
      artifact = await this.options.artifactRepository.register({ runId: task.runId, mimeType: format.mimeType, revisedPrompt: generated.revisedPrompt, ...stored });
    } catch (error) {
      await this.options.artifactStore.delete(stored.objectKey).catch(() => undefined);
      throw error;
    }
    const ref = { id: artifact.id, mimeType: format.mimeType, sha256: stored.sha256, byteSize: stored.byteSize };
    return {
      status: "COMPLETED",
      output: [{ type: "artifact", artifactId: artifact.id, mimeType: format.mimeType }],
      summary: generated.revisedPrompt ?? "图片已生成",
      artifacts: [ref],
      decisions: [{ type: "image.generated", aspectRatio: config.aspectRatio, size: config.size }],
      followups: [], usage: { inputTokens: 0, outputTokens: 0 }, continuity: "FULL",
    };
  }
}
