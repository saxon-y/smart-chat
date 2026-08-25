import { describe, expect, it } from "vitest";
import { mergeMessage } from "./message-list";

describe("mergeMessage", () => {
  it("does not treat null clientId as an identity match", () => {
    const current = [
      { id: "old-1", body: "hello", clientId: null, roomSequence: 1 },
      { id: "user-1", body: "@大聪明 hi", clientId: "c1", roomSequence: 2 },
    ];
    const ai = {
      id: "ai-1",
      body: "reply",
      clientId: null,
      roomSequence: 3,
      kind: "AI",
    };

    expect(mergeMessage(current, ai).map((message) => message.id)).toEqual([
      "old-1",
      "user-1",
      "ai-1",
    ]);
  });

  it("replaces an optimistic send by clientId and keeps roomSequence order", () => {
    const current: Array<{
      id: string;
      body: string;
      clientId: string | null;
      roomSequence?: number;
      createdAt?: string;
    }> = [
      { id: "old-1", body: "hello", clientId: null, roomSequence: 1 },
      { id: "local-c2", body: "@大聪明 hi", clientId: "c2", createdAt: "2026-08-19T03:00:00.000Z" },
    ];
    const confirmed = {
      id: "user-2",
      body: "@大聪明 hi",
      clientId: "c2",
      roomSequence: 2,
      createdAt: "2026-08-19T03:00:01.000Z",
    };
    const lateOlder = {
      id: "user-0",
      body: "earlier",
      clientId: "c0",
      roomSequence: 0,
    };

    const confirmedList = mergeMessage(current, confirmed);
    expect(confirmedList.map((message) => message.id)).toEqual(["old-1", "user-2"]);

    expect(mergeMessage(confirmedList, lateOlder).map((message) => message.id)).toEqual([
      "user-0",
      "old-1",
      "user-2",
    ]);
  });
});
