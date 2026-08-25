import { describe, expect, it } from "vitest";
import { PERSONAS } from "./personas";

describe("预制人格库", () => {
  it("包含足够多且 key 唯一的人格", () => {
    expect(PERSONAS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PERSONAS.map((persona) => persona.key)).size).toBe(PERSONAS.length);
  });

  it("每个人格都具备可直接创建 Agent 的完整字段", () => {
    for (const persona of PERSONAS) {
      expect(persona.key).toMatch(/^[a-z0-9-]+$/);
      expect(persona.name.trim()).not.toBe("");
      expect(persona.description.trim()).not.toBe("");
      expect(persona.systemPrompt.trim()).not.toBe("");
    }
  });
});
