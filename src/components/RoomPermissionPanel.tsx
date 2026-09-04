"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
type Permission = { userId: string; canView: boolean; canPost: boolean; canAddAgent: boolean; canApprove: boolean; canArtifacts: boolean };
export default function RoomPermissionPanel({ roomId }: { roomId: string }) {
  const [items, setItems] = useState<Permission[]>([]);
  useEffect(() => { void api<{ permissions: Permission[] }>(`/api/rooms/${encodeURIComponent(roomId)}/permissions`).then((result) => setItems(result.permissions)); }, [roomId]);
  return <section aria-label="频道权限"><h2>频道权限</h2>{items.map((item) => <div key={item.userId}><strong>{item.userId}</strong><span>{item.canView ? "可查看" : "已拒绝"} · {item.canPost ? "可发言" : "只读"}</span></div>)}</section>;
}
