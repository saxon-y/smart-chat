export type ModerationResult = { allowed: true } | { allowed: false; reasonCode: string };

export function moderateImagePrompt(prompt: string): ModerationResult {
  const normalized = prompt.normalize("NFC").trim();
  if (!normalized || normalized.length > 4000) return { allowed: false, reasonCode: "PROMPT_LENGTH" };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) return { allowed: false, reasonCode: "PROMPT_CONTROL_CHARACTERS" };
  const blocked = (process.env.IMAGE_PROMPT_BLOCKLIST ?? "")
    .split(",")
    .map((term) => term.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (blocked.some((term) => normalized.toLocaleLowerCase().includes(term))) return { allowed: false, reasonCode: "PROMPT_BLOCKED_TERM" };
  return { allowed: true };
}
