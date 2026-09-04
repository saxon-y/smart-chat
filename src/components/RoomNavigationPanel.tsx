"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
type Room = { id: string; name: string; slug?: string; groupName: string; favorite: boolean; collapsed: boolean };
export default function RoomNavigationPanel({ onSelect }: { onSelect?: (room: Room) => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  useEffect(() => { void api<{ rooms: Room[] }>("/api/rooms/navigation").then((result) => setRooms(result.rooms)); }, []);
  const groups = [...new Set(rooms.map((room) => room.groupName))];
  return <nav aria-label="房间导航">{groups.map((group) => <section key={group}><h3>{group}</h3>{rooms.filter((room) => room.groupName === group && !room.collapsed).sort((a, b) => Number(b.favorite) - Number(a.favorite)).map((room) => <button key={room.id} type="button" onClick={() => onSelect?.(room)}>{room.favorite ? "★ " : ""}{room.name}</button>)}</section>)}</nav>;
}
