import { db } from "@/lib/db";

export async function listRoomNavigation(userId: string) {
  const memberships = await db.roomMember.findMany({ where: { userId, principalType: "USER", leftAt: null }, select: { roomId: true, room: { select: { id: true, name: true, slug: true, status: true } } } });
  const preferences = await db.roomPreference.findMany({ where: { userId, roomId: { in: memberships.map((m) => m.roomId) } }, orderBy: [{ groupName: "asc" }, { position: "asc" }] });
  const byRoom = new Map(preferences.map((p) => [p.roomId, p]));
  return memberships.map(({ room }) => ({ ...room, ...(byRoom.get(room.id) ?? { groupName: "默认", position: 0, favorite: false, collapsed: false }) }));
}

export async function updateRoomPreference(userId: string, roomId: string, input: { groupName?: string; position?: number; favorite?: boolean; collapsed?: boolean }) {
  const member = await db.roomMember.findFirst({ where: { userId, roomId, principalType: "USER", leftAt: null }, select: { id: true } });
  if (!member) throw new Error("FORBIDDEN");
  return db.roomPreference.upsert({ where: { userId_roomId: { userId, roomId } }, create: { userId, roomId, groupName: input.groupName?.trim().slice(0, 80) || "默认", position: Math.max(0, Math.floor(input.position ?? 0)), favorite: Boolean(input.favorite), collapsed: Boolean(input.collapsed) }, update: { ...(input.groupName !== undefined ? { groupName: input.groupName.trim().slice(0, 80) || "默认" } : {}), ...(input.position !== undefined ? { position: Math.max(0, Math.floor(input.position)) } : {}), ...(input.favorite !== undefined ? { favorite: input.favorite } : {}), ...(input.collapsed !== undefined ? { collapsed: input.collapsed } : {}) } });
}

export async function roomPermission(userId: string, roomId: string, key: "canView" | "canPost" | "canAddAgent" | "canApprove" | "canArtifacts") {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === "ADMIN") return true;
  const member = await db.roomMember.findFirst({ where: { userId, roomId, principalType: "USER", leftAt: null }, select: { id: true, roomRole: true } });
  if (!member) return false;
  if (["OWNER", "MODERATOR"].includes(member.roomRole) && ["canAddAgent", "canApprove"].includes(key)) return true;
  const policy = await db.roomPermission.findUnique({ where: { roomId_userId: { roomId, userId } } });
  return policy ? policy[key] : key === "canView" || key === "canPost" || key === "canArtifacts";
}

export async function requireRoomPermission(userId: string, roomId: string, key: "canView" | "canPost" | "canAddAgent" | "canApprove" | "canArtifacts") {
  if (!(await roomPermission(userId, roomId, key))) throw new Error("ROOM_PERMISSION_DENIED");
}
