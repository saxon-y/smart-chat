import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  roomMember: { findFirst: vi.fn() },
  roomPermission: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { roomPermission } from "./rooms";

describe("room permission matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.findUnique.mockResolvedValue({ role: "USER" });
    dbMock.roomMember.findFirst.mockResolvedValue({ id: "member-1", roomRole: "MEMBER" });
    dbMock.roomPermission.findUnique.mockResolvedValue(null);
  });

  it("denies every permission after membership is revoked", async () => {
    dbMock.roomMember.findFirst.mockResolvedValue(null);
    await expect(roomPermission("user-1", "room-1", "canView")).resolves.toBe(false);
    await expect(roomPermission("user-1", "room-1", "canPost")).resolves.toBe(false);
  });

  it("uses least privilege defaults for high-risk actions", async () => {
    await expect(roomPermission("user-1", "room-1", "canView")).resolves.toBe(true);
    await expect(roomPermission("user-1", "room-1", "canAddAgent")).resolves.toBe(false);
    await expect(roomPermission("user-1", "room-1", "canApprove")).resolves.toBe(false);
  });

  it("honors explicit deny before normal member defaults", async () => {
    dbMock.roomPermission.findUnique.mockResolvedValue({ canView: false, canPost: false, canAddAgent: false, canApprove: false, canArtifacts: false });
    await expect(roomPermission("user-1", "room-1", "canView")).resolves.toBe(false);
    await expect(roomPermission("user-1", "room-1", "canArtifacts")).resolves.toBe(false);
  });

  it("allows room owners and system administrators to recover high-risk operations", async () => {
    dbMock.roomMember.findFirst.mockResolvedValue({ id: "owner-1", roomRole: "OWNER" });
    await expect(roomPermission("user-1", "room-1", "canApprove")).resolves.toBe(true);
    dbMock.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    dbMock.roomMember.findFirst.mockResolvedValue(null);
    await expect(roomPermission("admin-1", "room-1", "canAddAgent")).resolves.toBe(true);
  });
});
