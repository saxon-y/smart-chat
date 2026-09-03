import { describe, expect, it } from "vitest";
import { presentApproval } from "./presentation";

describe("presentApproval", () => {
  it("creates a readable, bounded summary without arguments or digests", () => {
    const result = presentApproval({ toolId: "room.write", risk: "WRITE", target: "  #产品实验室  " });
    expect(result).toMatchObject({ toolLabel: "write", riskLabel: "修改信息", targetLabel: "#产品实验室", requiresPrivilege: true });
    expect(JSON.stringify(result)).not.toContain("digest");
  });

  it("uses safe fallback labels for unknown values", () => {
    expect(presentApproval({ toolId: "mcp://dangerous?secret=1", risk: "UNKNOWN", status: "OTHER" })).toMatchObject({ toolLabel: "dangeroussecret1", riskLabel: "需要确认的操作", statusLabel: "等待确认" });
  });
});
