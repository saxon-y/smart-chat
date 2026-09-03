import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  threadRead: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};
const db = {
  $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
};

vi.mock("@/lib/db", () => ({ db }));
vi.mock("./events", () => ({ publishThreadReply: vi.fn() }));

describe("markThreadRead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a normalized initial cursor", async () => {
    tx.threadRead.findUnique.mockResolvedValue(null);
    tx.threadRead.create.mockResolvedValue({ lastSequence: 0 });
    const { markThreadRead } = await import("./thread");
    await markThreadRead("thread-1", "member-1", -4);
    expect(tx.threadRead.create).toHaveBeenCalledWith({ data: { threadId: "thread-1", memberId: "member-1", lastSequence: 0 } });
  });

  it("never moves an existing cursor backwards", async () => {
    tx.threadRead.findUnique.mockResolvedValue({ threadId: "thread-1", memberId: "member-1", lastSequence: 9 });
    const { markThreadRead } = await import("./thread");
    await expect(markThreadRead("thread-1", "member-1", 4)).resolves.toMatchObject({ lastSequence: 9 });
    expect(tx.threadRead.update).not.toHaveBeenCalled();
  });

  it("advances an existing cursor", async () => {
    tx.threadRead.findUnique.mockResolvedValue({ threadId: "thread-1", memberId: "member-1", lastSequence: 9 });
    tx.threadRead.update.mockResolvedValue({ lastSequence: 12 });
    const { markThreadRead } = await import("./thread");
    await markThreadRead("thread-1", "member-1", 12);
    expect(tx.threadRead.update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastSequence: 12 } }));
  });
});
