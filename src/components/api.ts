export type User = {
  id?: string;
  email?: string;
  displayName?: string;
  role?: "USER" | "ADMIN" | string;
  isAdmin?: boolean;
  avatarKey?: string | null;
  primaryColor?: string | null;
};

export type Room = {
  id: string;
  name: string;
  slug?: string;
  memberCount?: number;
  lastSequence?: number;
};
export type Member = {
  id: string;
  displayName: string;
  avatarKey?: string | null;
  primaryColor?: string | null;
  principalType?: string;
  assistantKey?: string | null;
  role?: string;
  online?: boolean;
  userId?: string;
  isMe?: boolean;
};
export type Message = {
  id: string;
  body: string;
  senderMemberId?: string;
  senderName?: string;
  kind?: string;
  createdAt?: string;
  status?: string;
  clientId?: string | null;
  roomSequence?: number;
  mentions?: Array<{ memberId: string; start: number; end: number }>;
  contentParts?: Array<{ type: string; dataUrl?: string; url?: string; name?: string; alt?: string }> | null;
  metadata?: Record<string, unknown> | null;
};

export type AgentRun = {
  id: string;
  agentKey?: string;
  agentName?: string;
  mode?: string;
  status?: string;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      payload?.error?.message ??
        payload?.message ??
        `请求失败（${response.status}）`,
    );
  return payload as T;
}

export function unwrap<T>(
  payload: T | { data?: T; user?: T; room?: T; rooms?: T; members?: T; messages?: T },
): T {
  if (payload && typeof payload === "object") {
    if ("data" in payload && payload.data !== undefined)
      return payload.data as T;
    if ("user" in payload && payload.user !== undefined)
      return payload.user as T;
    if ("room" in payload && payload.room !== undefined)
      return payload.room as T;
    if ("rooms" in payload && payload.rooms !== undefined)
      return payload.rooms as T;
    if ("members" in payload && payload.members !== undefined)
      return payload.members as T;
    if ("messages" in payload && payload.messages !== undefined)
      return payload.messages as T;
  }
  return payload as T;
}

export function initials(name?: string) {
  return (name ?? "我")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatTime(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}


export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (e.g. http://<lan-ip>): Web Crypto's
  // randomUUID is only available in secure contexts, but getRandomValues is not.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
