import { describe, expect, it, vi } from "vitest";
import type { TaskEnvelope } from "../../protocol";
import { EmbeddedImageRuntime } from "./image";

function task(agent: Record<string, unknown> = {}): TaskEnvelope {
  return { runId: "run-1", roomId: "room-1", triggerMessageId: "message-1", objective: "画一只猫", agent } as TaskEnvelope;
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const jpeg = Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]);

function setup(bytes: Uint8Array = png) {
  const generate = vi.fn().mockResolvedValue({ bytes, revisedPrompt: "cat" });
  const put = vi.fn().mockImplementation(async (objectKey: string, value: Uint8Array) => ({ objectKey, sha256: "abc", byteSize: value.byteLength }));
  const deleteObject = vi.fn().mockResolvedValue(undefined);
  const register = vi.fn().mockResolvedValue({ id: "artifact-1" });
  const runtime = new EmbeddedImageRuntime({
    generator: { generate }, artifactStore: { put, delete: deleteObject }, artifactRepository: { register },
    createObjectKey: (extension) => `generated/fixed.${extension}`,
  });
  return { runtime, generate, put, deleteObject, register };
}

describe("EmbeddedImageRuntime", () => {
  it.each([[png, "image/png", "generated/fixed.png"], [jpeg, "image/jpeg", "generated/fixed.jpg"]] as const)("validates and registers supported image formats", async (bytes, mimeType, objectKey) => {
    const { runtime, register } = setup(bytes);
    const result = await (await runtime.execute(task())).result;
    expect(result.artifacts).toEqual([{ id: "artifact-1", mimeType, sha256: "abc", byteSize: bytes.byteLength }]);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ mimeType, objectKey }));
  });

  it("rejects invalid images and images over 20 MiB before storage", async () => {
    const invalid = setup(Buffer.from("not an image"));
    await expect((await invalid.runtime.execute(task())).result).rejects.toMatchObject({ code: "provider_invalid_image" });
    expect(invalid.put).not.toHaveBeenCalled();

    const oversized = setup(Buffer.concat([png, Buffer.alloc(20 * 1024 * 1024)]));
    await expect((await oversized.runtime.execute(task())).result).rejects.toMatchObject({ code: "provider_image_too_large" });
    expect(oversized.put).not.toHaveBeenCalled();
  });

  it("rolls back object storage when artifact registration fails", async () => {
    const ports = setup();
    ports.register.mockRejectedValueOnce(new Error("database unavailable"));
    await expect((await ports.runtime.execute(task())).result).rejects.toThrow("database unavailable");
    expect(ports.deleteObject).toHaveBeenCalledWith("generated/fixed.png");
  });

  it("maps supported Gemini aspect ratios and falls back safely", async () => {
    const first = setup();
    await (await first.runtime.execute(task({ providerType: "GEMINI_IMAGES", image: { aspect: "3:2" } }))).result;
    expect(first.generate).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: "4:3" }));

    const fallback = setup();
    await (await fallback.runtime.execute(task({ providerType: "GEMINI_IMAGES", image: { aspect: "20:1" } }))).result;
    expect(fallback.generate).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: "1:1" }));
  });

  it("moderates the final composed prompt before generation", async () => {
    const ports = setup();
    const moderate = vi.fn().mockReturnValue({ allowed: false, reasonCode: "PROMPT_BLOCKED_TERM" });
    const runtime = new EmbeddedImageRuntime({
      generator: { generate: ports.generate }, artifactStore: { put: ports.put, delete: ports.deleteObject },
      artifactRepository: { register: ports.register }, moderate,
    });
    await expect((await runtime.execute(task({ systemPrompt: "policy" }))).result).rejects.toMatchObject({ code: "prompt_blocked_term" });
    expect(moderate).toHaveBeenCalledWith("policy\n\n用户要求：画一只猫");
    expect(ports.generate).not.toHaveBeenCalled();
  });
});
