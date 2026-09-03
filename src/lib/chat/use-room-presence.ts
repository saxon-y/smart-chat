"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RoomPresence = { userId: string; displayName: string; online: boolean; expiresAt: number };
export type RoomTyping = { userId: string; displayName: string; expiresAt: number };

export function useRoomPresence(roomId: string | undefined) {
  const [presence, setPresence] = useState<RoomPresence[]>([]);
  const [typing, setTyping] = useState<RoomTyping[]>([]);
  const lastTyping = useRef(0);
  useEffect(() => {
    if (!roomId) return;
    const source = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/events`);
    const onEvent = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as RoomPresence & { type: string };
      if (data.type === "presence") setPresence((current) => [...current.filter((item) => item.userId !== data.userId), data]);
      if (data.type === "typing") setTyping((current) => [...current.filter((item) => item.userId !== data.userId), data]);
    };
    source.addEventListener("message", onEvent);
    return () => source.close();
  }, [roomId]);
  useEffect(() => { const timer = window.setInterval(() => { const now = Date.now(); setPresence((items) => items.filter((item) => item.expiresAt > now)); setTyping((items) => items.filter((item) => item.expiresAt > now)); }, 1000); return () => window.clearInterval(timer); }, []);
  const announceTyping = useCallback(() => {
    if (!roomId || Date.now() - lastTyping.current < 1000) return;
    lastTyping.current = Date.now();
    void fetch(`/api/rooms/${encodeURIComponent(roomId)}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "typing" }), credentials: "include" });
  }, [roomId]);
  const announcePresence = useCallback((online: boolean) => {
    if (!roomId) return;
    void fetch(`/api/rooms/${encodeURIComponent(roomId)}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "presence", online }), credentials: "include" });
  }, [roomId]);
  return { presence, typing, announceTyping, announcePresence };
}
