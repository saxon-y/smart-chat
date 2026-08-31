"use client";

import {
  AlertCircle,
  Bell,
  Ban,
  Bot,
  EllipsisVertical,
  Hash,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Menu,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Smile,
  Sparkles,
  VolumeOff,
  X,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { mergeMessage } from "@/lib/chat/message-list";
import { WECHAT_EMOJI, getWechatEmoji } from "@/lib/wechat-emoji";
import {
  api,
  formatTime,
  initials,
  Member,
  Message,
  AgentRun,
  Room,
  unwrap,
  User,
  uuid,
} from "./api";

const demoRooms: Room[] = [
  { id: "lobby", name: "大厅", memberCount: 12 },
  { id: "product", name: "产品实验室", memberCount: 8 },
  { id: "design", name: "设计评审", memberCount: 6 },
  { id: "random", name: "随便聊聊", memberCount: 19 },
];
const demoMembers: Member[] = [
  {
    id: "member-assistant",
    displayName: "大聪明",
    principalType: "ASSISTANT",
    role: "AI 助手",
    online: true,
  },
  {
    id: "member-maya",
    displayName: "陈美雅",
    role: "产品",
    online: true,
  },
  {
    id: "member-jon",
    displayName: "钟杰",
    role: "工程",
    online: true,
  },
  {
    id: "member-iris",
    displayName: "林晓",
    role: "设计",
    online: false,
  },
];
const demoMessages: Message[] = [];

function Avatar({
  name,
  assistant = false,
  url,
  onClick,
}: {
  name?: string;
  assistant?: boolean;
  url?: string | null;
  onClick?: () => void;
}) {
  const content = url ? (
      <span
        className="avatar has-image"
        style={{
          backgroundImage: `url(${url})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          color: "transparent",
        }}
      >
        {" "}
      </span>
    ) : assistant ? (
      <span className="avatar assistant">
        <Bot size={15} />
      </span>
    ) : (
    <span className="avatar">
      {initials(name)}
    </span>
  );
  return onClick ? (
    <button type="button" className="avatar-button" onClick={onClick} aria-label={`查看${name ?? "成员"}的个人信息`}>
      {content}
    </button>
  ) : content;
}

function renderBody(body: string) {
  return body.split(/(\[[^\]]+\]|@[^\s]+)/g).map((part, index) => {
    if (part.startsWith("@")) {
      return (
        <span key={`${part}-${index}`} className="mention">
          {part}
        </span>
      );
    }
    const emoji = getWechatEmoji(part);
    if (emoji) {
      return (
        <img
          key={`${part}-${index}`}
          src={emoji.src}
          alt={emoji.name}
          title={emoji.name}
          className="wechat-emoji"
        />
      );
    }
    return part;
  });
}

function roleLabel(member: Member) {
  if (member.role === "OWNER") return "房主";
  if (member.role === "MODERATOR") return "管理员";
  if (member.role === "MEMBER") return "成员";
  if (member.role) return member.role;
  return member.principalType === "ASSISTANT" ? "AI 助手" : "成员";
}

function todayLabel() {
  return `今天，${new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}`;
}

export default function ChatWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>(demoRooms);
  const [activeRoom, setActiveRoom] = useState<Room>(demoRooms[0]);
  const [members, setMembers] = useState<Member[]>(demoMembers);
  const [messages, setMessages] = useState<Message[]>(demoMessages);
  const [draft, setDraft] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [roomFilter, setRoomFilter] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [thinking, setThinking] = useState(false);
  const [thinkingAgent, setThinkingAgent] = useState("");
  const [runStatuses, setRunStatuses] = useState<Record<string, { runId: string; agentKey?: string; agentName?: string; mode?: string; status?: string; progress?: number; error?: string }>>({});
  const [aiError, setAiError] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [profileMember, setProfileMember] = useState<Member | null>(null);
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});
  const [pinnedRooms, setPinnedRooms] = useState<Set<string>>(new Set());
  const [mutedRooms, setMutedRooms] = useState<Set<string>>(new Set());
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const thinkingTimerRef = useRef<number | null>(null);

  const updateRunStatus = useCallback((run: { runId?: string; id?: string; agentKey?: string; agentName?: string; mode?: string; status?: string; progress?: number; error?: string }) => {
    const runId = run.runId ?? run.id;
    if (!runId) return;
    setRunStatuses((current) => ({ ...current, [runId]: { ...current[runId], ...run, runId } }));
  }, []);

  const myMemberId = useMemo(
    () => members.find((member) => member.isMe)?.id ?? undefined,
    [members],
  );
  const myMemberIdRef = useRef<string | undefined>(myMemberId);
  useEffect(() => { myMemberIdRef.current = myMemberId; }, [myMemberId]);

  const upsertMessage = useCallback((msg: Message) => {
    setMessages((current) => mergeMessage(current, { ...msg, status: undefined }));
    if (msg.kind === "AI") {
      setThinking(false);
      if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
    }
  }, []);

  const notifyNewMessage = useCallback((msg: Message) => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (msg.senderMemberId === myMemberIdRef.current) return;
    const sender = msg.senderName ?? "新消息";
    const body = msg.body?.trim() || (msg.contentParts?.length ? "[图片]" : "");
    try {
      const n = new Notification(`${sender} · ${activeRoom.name}`, {
        body: body || "收到一条新消息",
        tag: msg.id,
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {
      // Notification API may be unavailable; ignore.
    }
  }, [activeRoom]);

  const markRoomRead = useCallback((roomId: string) => {
    setUnreadByRoom((current) => {
      if (!current[roomId]) return current;
      const next = { ...current };
      delete next[roomId];
      return next;
    });
  }, []);

type Attachment = { id: string; dataUrl: string; name?: string };
type AvailableAgent = { key: string; name: string; description: string; kind?: string; capabilities?: string[]; inRoom: boolean };
type SupervisorConfig = { id?: string; agentId?: string; enabled?: boolean; confidenceThreshold?: number; agent?: { id: string; key: string; name: string } | null };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([]);
  const [agentListLoading, setAgentListLoading] = useState(false);
  const [addingAgentKey, setAddingAgentKey] = useState("");
  const [agentListMessage, setAgentListMessage] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinReason, setJoinReason] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memberMenu, setMemberMenu] = useState<string | null>(null);
  const [supervisor, setSupervisor] = useState<SupervisorConfig | null>(null);
  const [supervisorSaving, setSupervisorSaving] = useState(false);

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    if (!el) { setDraft((current) => current + text); return; }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }
  function addEmoji(emoji: string) {
    insertAtCursor(emoji);
  }
  function addAttachment(file: File) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 3 * 1024 * 1024) { setNotice("图片过大（上限 3MB）"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setAttachments((current) => (current.length >= 4 ? current : [...current, { id: `${file.name}-${Date.now()}`, dataUrl, name: file.name }]));
    };
    reader.readAsDataURL(file);
  }
  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    let added = false;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { addAttachment(file); added = true; }
      }
    }
    if (added) event.preventDefault();
  }


  useEffect(() => {
    api<User | { data: User }>("/api/me")
      .then((response) => setUser(unwrap(response)))
      .catch(() => undefined);
  }, []);
  const requestNotifyPermission = useCallback(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    // Browsers require a user gesture to show the permission prompt, so
    // request it on the first user interaction instead of on mount.
    const handler = () => {
      requestNotifyPermission();
      window.removeEventListener("pointerdown", handler);
    };
    window.addEventListener("pointerdown", handler, { once: true });
    return () => window.removeEventListener("pointerdown", handler);
  }, [requestNotifyPermission]);
  useEffect(() => {
    api<Room[] | { rooms?: Room[]; data?: Room[] }>("/api/rooms")
      .then((response) => {
        const next = unwrap(response) as Room[];
        if (Array.isArray(next) && next.length) {
          setRooms(next);
          void api(`/api/rooms/${next[0].id}/members`, { method: "POST" })
            .then(() => setActiveRoom(next[0]))
            .catch(() => setActiveRoom(next[0]));
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const roomId = activeRoom?.id;
    const isDemo =
      !roomId ||
      roomId.startsWith("demo") ||
      ["lobby", "product", "design", "random"].includes(roomId);
    let cancelled = false;
    let eventSource: EventSource | null = null;
    Promise.all([
      api<Message[] | { messages?: Message[]; data?: Message[] }>(
        `/api/rooms/${roomId}/messages`,
      ).catch(() => null),
      api<Member[] | { members?: Member[]; data?: Member[] }>(
        `/api/rooms/${roomId}/members`,
      ).catch(() => null),
    ])
      .then(([messagePayload, memberPayload]) => {
        if (cancelled) return;
        const nextMessages = messagePayload
          ? (unwrap(messagePayload) as Message[])
          : null;
        const nextMembers = memberPayload
          ? (unwrap(memberPayload) as Member[])
          : null;
        if (Array.isArray(nextMessages)) setMessages(nextMessages);
        else if (!nextMessages) setMessages(demoMessages);
        if (Array.isArray(nextMembers)) setMembers(nextMembers);
        if (isDemo || !roomId) return;
        const lastSeq = nextMessages?.at(-1)?.roomSequence ?? 0;
        eventSource = new EventSource(`/api/rooms/${roomId}/events?after=${lastSeq}`);
        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data) as {
            type: string;
            message?: Message;
            agentName?: string;
            runId?: string;
            agentKey?: string;
            mode?: string;
            status?: string;
            progress?: number;
            error?: string;
            agentRun?: AgentRun;
            ok?: boolean;
          };
          if (data.type === "message" && data.message) {
            const incoming = data.message;
            upsertMessage(incoming);
            const fromMe = incoming.senderMemberId === myMemberIdRef.current;
            if (!fromMe) {
              if (document.hidden) {
                setUnreadByRoom((cur) => ({ ...cur, [roomId]: (cur[roomId] ?? 0) + 1 }));
              }
              notifyNewMessage(incoming);
            }
          } else if (data.type === "ai_thinking") {
            setThinking(true);
            setAiError("");
            setThinkingAgent(data.agentName ?? "AI 助手");
            if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
            thinkingTimerRef.current = window.setTimeout(() => setThinking(false), 90000);
          } else if (data.type === "ai_done") {
            setThinking(false);
            if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
            if (data.ok === false) {
              setAiError("助手暂时无法回复，请稍后再试或检查模型配置。");
              window.setTimeout(() => setAiError(""), 6000);
            }
          } else if (["agent_queued", "agent_routed", "agent_progress", "agent_done"].includes(data.type)) {
            updateRunStatus({ runId: data.runId, agentKey: data.agentKey, agentName: data.agentName, mode: data.mode, status: data.status ?? data.type.replace("agent_", ""), progress: data.progress, error: data.error });
            if (data.type === "agent_done" && data.ok === false) {
              setAiError(data.error ?? "助手暂时无法回复，请稍后再试。");
              window.setTimeout(() => setAiError(""), 6000);
            }
          }
        };
        eventSource.onerror = () => {
          // EventSource reconnects automatically; the server replays messages
          // created while disconnected and upsertMessage de-duplicates them.
        };
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      eventSource?.close();
      if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
      setThinking(false);
    };
  }, [activeRoom, notifyNewMessage, updateRunStatus, upsertMessage]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  const filteredRooms = useMemo(
    () =>
      rooms
        .filter((room) =>
          room.name.toLowerCase().includes(roomFilter.toLowerCase()),
        )
        .sort((a, b) => {
          const ap = pinnedRooms.has(a.id) ? 1 : 0;
          const bp = pinnedRooms.has(b.id) ? 1 : 0;
          return bp - ap;
        }),
    [rooms, roomFilter, pinnedRooms],
  );
  const totalUnread = useMemo(
    () => Object.values(unreadByRoom).reduce((sum, n) => sum + n, 0),
    [unreadByRoom],
  );
  const mentionQuery = draft.match(/@([^\s]*)$/)?.[1]?.toLowerCase() ?? "";
  const mentionOptions = members
    .filter((member) => member.displayName.toLowerCase().includes(mentionQuery));
  const canManageAgents = members.some((member) => member.isMe && member.role === "OWNER") || user?.role === "ADMIN" || user?.isAdmin === true;
  const canManageMembers = canManageAgents;

  async function submitJoinRequest() {
    const value = joinRoomId.trim();
    if (!value) return;
    try {
      await api(`/api/rooms/${encodeURIComponent(value)}/join-requests`, { method: "POST", body: JSON.stringify({ reason: joinReason.trim() || undefined }) });
      setJoinOpen(false); setJoinRoomId(""); setJoinReason(""); setNotice("加入申请已提交");
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法提交加入申请"); }
  }

  async function inviteMember() {
    const userId = inviteUserId.trim();
    if (!userId) return;
    try { await api(`/api/rooms/${activeRoom.id}/invitations`, { method: "POST", body: JSON.stringify({ userId }) }); setInviteOpen(false); setInviteUserId(""); setNotice("邀请已发送"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "邀请失败"); }
  }

  async function moderateMember(member: Member, action: "mute" | "remove") {
    setMemberMenu(null);
    try {
      await api(`/api/rooms/${activeRoom.id}/members/${member.id}/${action}`, { method: "POST", body: JSON.stringify(action === "mute" ? { durationMinutes: 60 } : {}) });
      if (action === "remove") setMembers((current) => current.filter((item) => item.id !== member.id));
      else setNotice(`${member.displayName} 已禁言 1 小时`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "操作失败"); }
  }

  useEffect(() => {
    if (!mentionOpen) return;
    mentionMenuRef.current
      ?.querySelector<HTMLElement>(".mention-option.selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [mentionIndex, mentionOpen]);

  useEffect(() => {
    if (!activeRoom?.id) return;
    api<{ supervisor?: SupervisorConfig | null }>(`/api/rooms/${activeRoom.id}/supervisor`)
      .then((payload) => {
        setSupervisor(payload.supervisor ?? null);
      })
      .catch(() => undefined);
    api<{ available?: AvailableAgent[] }>(`/api/rooms/${activeRoom.id}/agents`)
      .then((payload) => setAvailableAgents(payload.available ?? []))
      .catch(() => undefined);
  }, [activeRoom?.id]);

  async function saveSupervisor(next: Partial<SupervisorConfig>) {
    setSupervisorSaving(true);
    try {
      const payload = await api<{ supervisor?: SupervisorConfig }>(`/api/rooms/${activeRoom.id}/supervisor`, {
        method: "PUT",
        body: JSON.stringify({ enabled: next.enabled ?? supervisor?.enabled ?? true }),
      });
      setSupervisor(payload.supervisor ?? { ...supervisor, ...next });
      setNotice("房间总管设置已更新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存总管设置");
    } finally {
      setSupervisorSaving(false);
    }
  }

  async function loadAvailableAgents() {
    setAgentListLoading(true);
    setAgentListMessage("");
    try {
      const response = await api<{ available: AvailableAgent[] }>(`/api/rooms/${activeRoom.id}/agents`);
      setAvailableAgents(response.available ?? []);
    } catch (error) {
      setAgentListMessage(error instanceof Error ? error.message : "无法加载 Agent 列表");
    } finally {
      setAgentListLoading(false);
    }
  }

  async function addAgent(agent: AvailableAgent) {
    setAddingAgentKey(agent.key);
    setAgentListMessage("");
    try {
      await api(`/api/rooms/${activeRoom.id}/agents`, {
        method: "POST",
        body: JSON.stringify({ agentKey: agent.key }),
      });
      const response = await api<Member[] | { members?: Member[]; data?: Member[] }>(`/api/rooms/${activeRoom.id}/members`);
      const nextMembers = unwrap(response) as Member[];
      if (Array.isArray(nextMembers)) {
        setMembers(nextMembers);
        setActiveRoom((current) => ({ ...current, memberCount: nextMembers.length }));
      }
      setAvailableAgents((current) => current.map((item) => item.key === agent.key ? { ...item, inRoom: true } : item));
      setAgentListMessage(`已添加「${agent.name}」`);
    } catch (error) {
      setAgentListMessage(error instanceof Error ? error.message : "无法添加 Agent");
    } finally {
      setAddingAgentKey("");
    }
  }

  async function removeAgent(member: Member) {
    let agentKey = member.assistantKey
      ?? availableAgents.find((agent) => agent.name === member.displayName)?.key;
    if (!agentKey) {
      try {
        const response = await api<{ available?: AvailableAgent[] }>(`/api/rooms/${activeRoom.id}/agents`);
        const match = response.available?.find((agent) => agent.name === member.displayName);
        if (match) {
          agentKey = match.key;
          setAvailableAgents(response.available ?? []);
        }
      } catch {
        // Keep the action inert when the lookup fails.
      }
    }
    if (!agentKey) return;
    if (!window.confirm(`从房间移除「${member.displayName}」？`)) return;
    try {
      await api(`/api/rooms/${activeRoom.id}/agents?agentKey=${encodeURIComponent(agentKey)}`, { method: "DELETE" });
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setActiveRoom((current) => ({ ...current, memberCount: Math.max(0, (current.memberCount ?? members.length) - 1) }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法移除 Agent");
    }
  }

  async function actOnRun(runId: string, action: "retry" | "cancel") {
    try {
      const response = await api<{ run?: AgentRun; agentRun?: AgentRun }>(`/api/rooms/${activeRoom.id}/runs/${runId}/${action}`, { method: "POST" });
      updateRunStatus({ runId, ...(response.run ?? response.agentRun ?? {}), status: action === "retry" ? "queued" : "cancelled", error: undefined });
      if (action === "retry") setThinking(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `无法${action === "retry" ? "重试" : "取消"}任务`);
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    setMentionOpen(/@[^\s]*$/.test(value));
    setMentionIndex(0);
  }
  function switchRoom(room: Room) {
    setAddAgentOpen(false);
    setAgentListMessage("");
    setRunStatuses({});
    setActiveRoom(room);
  }
  function chooseMention(member: Member) {
    setDraft((current) =>
      current.replace(/@[^\s]*$/, `@${member.displayName} `),
    );
    setMentionOpen(false);
    textareaRef.current?.focus();
  }
  async function submitMessage() {
    requestNotifyPermission();
    const body = draft.trim();
    if (loading) return;
    if (!body && attachments.length === 0) return;
    const clientId = uuid();
    const optimistic: Message = {
      id: `local-${clientId}`,
      clientId,
      senderMemberId: myMemberId,
      senderName: user?.displayName ?? "我",
      body,
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setMentionOpen(false);
    try {
      const response = await api<{
        message?: Message;
        aiRunId?: string | null;
        agentRun?: AgentRun;
        aiRateLimited?: boolean;
        duplicate?: boolean;
      }>(`/api/rooms/${activeRoom.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body,
          clientId,
          attachments: attachments.map((a) => ({ type: "image", dataUrl: a.dataUrl, name: a.name })),
          mentions: members
            .filter((member) => body.includes(`@${member.displayName}`))
            .map((member) => {
              const start = body.indexOf(`@${member.displayName}`);
              return { memberId: member.id, start, end: start + member.displayName.length + 1 };
            }),
        }),
      });
      setAttachments([]);
      if (response.message) upsertMessage(response.message);
      if (response.aiRateLimited) setNotice("消息已发送，本次 Agent 调用因额度限制被跳过。");
      const run = response.agentRun ?? (response.aiRunId ? { id: response.aiRunId } : undefined);
      if (run?.id) {
        updateRunStatus({ runId: run.id, agentKey: run.agentKey, agentName: run.agentName, mode: run.mode, status: run.status ?? "queued" });
        const mentionedAgent = members.find((member) => member.principalType === "ASSISTANT" && body.includes(`@${member.displayName}`));
        setThinking(true);
        setThinkingAgent(mentionedAgent?.displayName ?? "AI 助手");
        if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = window.setTimeout(
          () => setThinking(false),
          90000,
        );
      }
    } catch {
      setNotice("消息已保存在本地。重新连接后即可发送。");
    }
  }
  async function createRoom() {
    const name = window.prompt("房间名称");
    if (!name?.trim()) return;
    try {
      const response = await api<Room | { room?: Room; data?: Room }>(
        "/api/rooms",
        { method: "POST", body: JSON.stringify({ name: name.trim() }) },
      );
      const room = unwrap(response) as Room;
      if (room?.id) {
        setRooms((current) => [room, ...current]);
        switchRoom(room);
      }
    } catch {
      setNotice("暂时无法创建房间。");
    }
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
  }

  const messageList = messages.map((message, index) => {
    const member = members.find((item) => item.id === message.senderMemberId);
    const assistant =
      message.kind === "AI" ||
      member?.principalType === "ASSISTANT" ||
      message.senderName === "大聪明";
    const isOwn = !assistant && (message.senderMemberId === myMemberId || (message.status === "sending" && message.senderMemberId === myMemberId));
    return (
      <article
        className={`message${assistant ? " assistant" : ""}${isOwn ? " own" : ""}`}
        key={message.id}
        style={{ animationDelay: `${Math.min(index * 35, 260)}ms`, ...(assistant && member?.primaryColor ? { "--agent-color": member.primaryColor } : {}) } as CSSProperties}
      >
        <Avatar
          name={message.senderName ?? member?.displayName}
          assistant={assistant}
          url={member?.avatarKey}
          onClick={member ? () => setProfileMember(member) : undefined}
        />
        <div className="message-content">
          <div className="message-meta">
            <span className="message-author">
              {message.senderName ?? member?.displayName ?? "未知"}
            </span>
            <span className="message-time">
              {formatTime(message.createdAt)}
            </span>
          </div>
          {message.body && <p className="message-body">{renderBody(message.body)}</p>}
          {message.contentParts && message.contentParts.length > 0 && (
            <div className="message-images">
              {message.contentParts
                .filter((part) => part.type === "image")
                .map((part, i) => (
                  (() => {
                    const imageUrl = part.url ?? part.dataUrl;
                    if (!imageUrl) return null;
                    return (
                  <button
                    key={i}
                    type="button"
                    className="message-image"
                    onClick={() => setPreviewImage(imageUrl)}
                  >
                    <img src={imageUrl} alt={part.alt ?? part.name ?? "图片"} />
                  </button>
                    );
                  })()
                ))}
            </div>
          )}
          {message.status && (
            <div className="message-status">
              {message.status === "sending" ? "发送中…" : message.status}
            </div>
          )}
        </div>
      </article>
    );
  });
  const mentionList = mentionOptions.map((member, index) => (
    <button
      key={member.id}
      type="button"
      className={`mention-option${index === mentionIndex ? " selected" : ""}`}
      onMouseDown={(event) => {
        event.preventDefault();
        chooseMention(member);
      }}
    >
      <Avatar
        name={member.displayName}
        assistant={member.principalType === "ASSISTANT"}
        url={member.avatarKey}
      />
      <span>
        <span className="mention-option-name">{member.displayName}</span>
        <span className="mention-option-role">{roleLabel(member)}</span>
      </span>
    </button>
  ));
  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (mentionOpen && mentionOptions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % mentionOptions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (index) =>
            (index - 1 + mentionOptions.length) % mentionOptions.length,
        );
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chooseMention(mentionOptions[mentionIndex]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  return (
    <div className="app-frame">
      <div className="app-shell">
        <aside className={`rail${railOpen ? " open" : ""}`}>
          <div className="brand">
            <span className="brand-mark">↗</span>
            <span className="brand-name">Smart Chat</span>
            <span className="brand-note">v0.1</span>
          </div>
          <div className="rail-label">
            <span>工作区</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`new-message-button${totalUnread > 0 ? " active" : ""}`}
                  aria-label="新消息"
                  title="查看新消息"
                  disabled={totalUnread === 0}
                >
                  <Bell size={14} />
                  {totalUnread > 0 && (
                    <span className="new-message-badge">{totalUnread}</span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56">
                <div className="unread-list">
                  <div className="unread-title">新消息</div>
                  {Object.entries(unreadByRoom).length === 0 && (
                    <div className="unread-empty">暂无新消息</div>
                  )}
                  {Object.entries(unreadByRoom)
                    .sort(([, a], [, b]) => b - a)
                    .map(([roomId, count]) => {
                      const room = rooms.find((r) => r.id === roomId);
                      if (!room) return null;
                      return (
                        <button
                          key={roomId}
                          type="button"
                          className="unread-item"
                          onClick={() => {
                            void api(`/api/rooms/${roomId}/members`, { method: "POST" })
                              .then(() => {
                                switchRoom(room);
                                markRoomRead(roomId);
                                setNotice("");
                              })
                              .catch(() => { setJoinRoomId(room.id); setJoinOpen(true); });
                            setRailOpen(false);
                          }}
                        >
                          <Hash size={13} />
                          <span className="unread-name">{room.name}</span>
                          <span className="unread-count">{count}</span>
                        </button>
                      );
                    })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="room-search-row">
            <div className="rail-search">
              <Search size={14} />
              <input
                aria-label="搜索房间"
                placeholder="查找房间"
                value={roomFilter}
                onChange={(event) => setRoomFilter(event.target.value)}
              />
            </div>
            <button type="button" className="room-join-inline" aria-label="申请加入聊天室" title="申请加入聊天室" onClick={() => setJoinOpen(true)}><Plus size={15} /></button>
          </div>
          <div className="room-list" aria-label="房间">
            {filteredRooms.map((room) => {
              const isPinned = pinnedRooms.has(room.id);
              const isMuted = mutedRooms.has(room.id);
              const unread = unreadByRoom[room.id] ?? 0;
              return (
                <div
                  key={room.id}
                  className={`room-item${activeRoom.id === room.id ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="room-main"
                    onClick={() => {
                      void api(`/api/rooms/${room.id}/members`, { method: "POST" })
                        .then(() => {
                          switchRoom(room);
                          markRoomRead(room.id);
                          setNotice("");
                        })
                        .catch(() => { setJoinRoomId(room.id); setJoinOpen(true); });
                      setRailOpen(false);
                    }}
                  >
                    <Hash size={15} className="room-hash" />
                    <span className="room-name">{room.name}</span>
                    {isMuted && <VolumeOff size={12} className="room-mute" />}
                    {isPinned && <Pin size={12} className="room-pin" />}
                    {unread > 0 ? (
                      <span className="room-unread">{unread}</span>
                    ) : (
                      <span className="room-count">{room.memberCount ?? "—"}</span>
                    )}
                  </button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="room-menu"
                        aria-label="房间操作"
                        title="房间操作"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <EllipsisVertical size={15} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-40">
                      <div className="more-menu">
                        <button
                          type="button"
                          className="more-menu-item"
                          onClick={() => {
                            setPinnedRooms((current) => {
                              const next = new Set(current);
                              if (next.has(room.id)) next.delete(room.id);
                              else next.add(room.id);
                              return next;
                            });
                          }}
                        >
                          <Pin size={14} />
                          <span>{isPinned ? "取消置顶" : "置顶"}</span>
                        </button>
                        <button
                          type="button"
                          className="more-menu-item"
                          onClick={() => {
                            setMutedRooms((current) => {
                              const next = new Set(current);
                              if (next.has(room.id)) next.delete(room.id);
                              else next.add(room.id);
                              return next;
                            });
                          }}
                        >
                          <VolumeOff size={14} />
                          <span>{isMuted ? "取消静音" : "静音"}</span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
          </div>
          <div className="rail-actions">
            <button className="rail-button" onClick={createRoom}>
              <Plus size={14} /> 新建房间
            </button>
            <a className="rail-button" href="/settings/profile">
              <Settings2 size={14} /> 个人资料
            </a>
            {(user?.role === "ADMIN" || user?.isAdmin) && (
              <a className="rail-button" href="/admin">
                <Sparkles size={14} /> 后台管理
              </a>
            )}
          </div>
          <div className="account-chip">
            <Avatar name={user?.displayName} url={user?.avatarKey} />
            <div>
              <div className="account-name">{user?.displayName ?? "访客"}</div>
              <div className="account-email">
                {user?.email ?? "登录后同步"}
              </div>
            </div>
            <button
              className="account-action"
              aria-label="退出登录"
              title="退出登录"
              onClick={logout}
            >
              <LogOut size={14} />
            </button>
          </div>
        </aside>
        <main className="workspace">
          <section className="chat-column">
            <header className="chat-header">
              <button
                className="mobile-menu"
                aria-label="打开房间列表"
                title="打开房间列表"
                onClick={() => setRailOpen(true)}
              >
                <Menu size={20} />
              </button>
              <div className="room-title">
                <h1>{activeRoom.name}</h1>
                <p>
                  公开 / 进行中 · {activeRoom.memberCount ?? members.length}{" "}
                  位成员
                </p>
              </div>
              <div className="header-spacer" />
            </header>
            <div className="message-scroll" aria-live="polite" ref={scrollRef}>
              <div className="day-rule">{todayLabel()}</div>
              <div className="messages">
                {messageList}
                {Object.values(runStatuses).filter((run) => !["succeeded", "success", "done", "cancelled", "no_action"].includes((run.status ?? "").toLowerCase())).map((run) => {
                  const status = (run.status ?? "").toLowerCase();
                  const failed = ["failed", "error", "failed_retryable", "failed_final"].includes(status);
                  return (
                  <article className="message assistant thinking" key={`run-${run.runId}`}>
                    <Avatar name={run.agentName || "AI 助手"} assistant />
                    <div className="message-content">
                      <div className="message-meta">
                        <span className="message-author">{run.agentName || "AI 助手"}</span>
                        {run.mode && <span className="message-time">{run.mode === "DIRECT" ? "直达" : "自动调度"}</span>}
                      </div>
                      <p className={`message-body thinking-body${failed ? " ai-error" : ""}`}>
                        {failed ? <><AlertCircle size={13} /> {run.error === "provider_outcome_unknown" ? "图片服务连接超时，请检查网络或稍后重试" : run.error === "provider_api_key_missing" ? "图片模型未配置 API Key" : run.error?.startsWith("provider_http_") ? `图片服务请求失败（${run.error.replace("provider_http_", "HTTP ") }）` : "系统错误"}</> : <><LoaderCircle size={13} className="spin" /> {status === "routed" ? `已交给${run.agentName || "助手"}处理` : status === "generating" ? `正在生成${run.agentName ? ` · ${run.agentName}` : ""}` : status === "queued" ? `排队中${run.agentName ? ` · ${run.agentName}` : ""}` : "处理中…"}</>}
                        {!failed && typeof run.progress === "number" && <span className="run-progress"> {Math.round(run.progress)}%</span>}
                      </p>
                      {run.status && failed && (
                        <div className="run-actions">
                          <button type="button" className="run-action" onClick={() => void actOnRun(run.runId, "retry")}><RefreshCw size={12} /> 重试</button>
                          <button type="button" className="run-action" onClick={() => void actOnRun(run.runId, "cancel")}><Ban size={12} /> 取消</button>
                        </div>
                      )}
                      {run.status && ["queued", "running", "generating", "routed", "pending"].includes(run.status.toLowerCase()) && (
                        <div className="run-actions"><button type="button" className="run-action" onClick={() => void actOnRun(run.runId, "cancel")}><Ban size={12} /> 取消</button></div>
                      )}
                    </div>
                  </article>
                  );
                })}
                {thinking && Object.keys(runStatuses).length === 0 && (
                  <article className="message assistant thinking">
                    <Avatar name={thinkingAgent || "大聪明"} assistant />
                    <div className="message-content">
                      <div className="message-meta">
                        <span className="message-author">{thinkingAgent || "大聪明"}</span>
                      </div>
                      <p className="message-body thinking-body">
                        <LoaderCircle size={13} className="spin" /> 正在思考中…
                      </p>
                    </div>
                  </article>
                )}
                {aiError && (
                  <div className="message-status ai-error">{aiError}</div>
                )}
                {loading && (
                  <div className="message-status">正在同步房间记录…</div>
                )}
              </div>
            </div>
            <div className="composer-wrap">
              <div className="composer">
                {mentionOpen && mentionOptions.length > 0 && (
                  <div
                    ref={mentionMenuRef}
                    className="mention-menu"
                    role="listbox"
                    aria-label="提及房间成员"
                  >
                    <div className="mention-label">提及成员</div>
                    {mentionList}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  onPaste={handlePaste}
                  placeholder="给房间写点什么… 使用 @ 提及成员"
                  rows={2}
                />
                {attachments.length > 0 && (
                  <div className="composer-attachments">
                    {attachments.map((attachment) => (
                      <div key={attachment.id} className="composer-attachment">
                        <img src={attachment.dataUrl} alt={attachment.name ?? "图片"} />
                        <button
                          type="button"
                          className="composer-attachment-remove"
                          aria-label="移除图片"
                          onClick={() => setAttachments((current) => current.filter((a) => a.id !== attachment.id))}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="composer-footer">
                  <div className="composer-tools">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="composer-tool" aria-label="添加表情" title="添加表情">
                          <Smile size={16} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72">
                        <div className="emoji-grid">
                          {WECHAT_EMOJI.map((emoji) => (
                            <button
                              key={emoji.code}
                              type="button"
                              className="emoji-item"
                              title={emoji.name}
                              onClick={() => addEmoji(emoji.code)}
                            >
                              <img src={emoji.src} alt={emoji.name} className="wechat-emoji" />
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <label className="composer-tool" title="发送图片">
                      <ImagePlus size={16} />
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(event) => {
                          for (const file of Array.from(event.target.files ?? [])) addAttachment(file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  <span className="composer-hint" aria-hidden="true" />
                  <button
                    className="send-button"
                    onClick={() => void submitMessage()}
                    disabled={!draft.trim() && attachments.length === 0}
                  >
                    <Send size={13} /> 发送
                  </button>
                </div>
              </div>
              {notice && (
                <div className="message-status" role="status">
                  {notice}
                </div>
              )}
            </div>
          </section>
          <aside className="context-panel">
            <div className="context-title">
              <h2>房间详情</h2>
              <button type="button" className="icon-button" aria-label="聊天室设置" title="聊天室设置" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /></button>
            </div>
            <div className="context-section">
              {canManageAgents && (
                <>
                  <div className="context-section-label">房间总管</div>
                  <div className="supervisor-controls">
                    <div className="supervisor-fixed-agent"><Bot size={14} /><span>{supervisor?.agent?.name ?? "房间总管"}</span></div>
                    <label className="supervisor-toggle"><span>自动调度房间 Agent</span><Switch className="supervisor-switch" thumbClassName="h-3.5 w-3.5 data-[state=checked]:translate-x-3.5" checked={supervisor?.enabled ?? false} disabled={supervisorSaving} onCheckedChange={(enabled) => void saveSupervisor({ enabled })} /></label>
                  </div>
                </>
              )}
            </div>
            <div className="context-section">
              <div className="context-section-heading"><div className="context-section-label">
                在线成员 · {members.filter((m) => m.online !== false && m.principalType !== "ASSISTANT").length}
              </div>{canManageMembers && <button type="button" className="icon-button" aria-label="邀请成员" title="邀请成员" onClick={() => setInviteOpen(true)}><Plus size={14} /></button>}</div>
              {members
                .filter((m) => m.online !== false && m.principalType !== "ASSISTANT")
                .map((member) => (
                  <div className="member-row" key={member.id}>
                    <Avatar
                      name={member.displayName}
                      url={member.avatarKey}
                      onClick={() => setProfileMember(member)}
                    />
                    <div>
                      <div className="member-name">{member.displayName}</div>
                      <div className="member-role">{roleLabel(member)}</div>
                      <div className="capability-badges">{(availableAgents.find((agent) => agent.name === member.displayName)?.capabilities ?? []).slice(0, 3).map((capability) => <span className="capability-badge" key={capability}>{capability}</span>)}</div>
                    </div>
                    <i className="member-state" />
                    {canManageMembers && !member.isMe && <Popover open={memberMenu === member.id} onOpenChange={(open) => setMemberMenu(open ? member.id : null)}><PopoverTrigger asChild><button type="button" className="member-actions" aria-label={`管理 ${member.displayName}`} title="成员管理"><EllipsisVertical size={14} /></button></PopoverTrigger><PopoverContent align="end" className="w-36"><div className="more-menu"><button type="button" className="more-menu-item" onClick={() => void moderateMember(member, "mute")}><VolumeOff size={14} /><span>禁言 1 小时</span></button><button type="button" className="more-menu-item danger" onClick={() => void moderateMember(member, "remove")}><Trash2 size={14} /><span>剔除成员</span></button></div></PopoverContent></Popover>}
                  </div>
                ))}
            </div>
            <div className="context-section">
              <div className="context-section-heading">
                <div className="context-section-label">
                  Agent · {members.filter((m) => m.principalType === "ASSISTANT").length}
                </div>
                {canManageAgents && (
                  <Popover open={addAgentOpen} onOpenChange={(open) => {
                    setAddAgentOpen(open);
                    if (open) void loadAvailableAgents();
                  }}>
                    <PopoverTrigger asChild>
                      <button className="icon-button agent-add-button" type="button" aria-label="添加 Agent" title="添加 Agent">
                        <Plus size={14} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="agent-picker">
                      <div className="agent-picker-title">添加 Agent</div>
                      {agentListLoading ? (
                        <div className="agent-picker-status"><LoaderCircle size={13} className="spin" /> 加载中…</div>
                      ) : availableAgents.filter((agent) => !agent.inRoom).length === 0 ? (
                        <div className="agent-picker-status">暂无可添加的 Agent</div>
                      ) : (
                        <div className="agent-picker-list">
                          {availableAgents.filter((agent) => !agent.inRoom).map((agent) => (
                            <button className="agent-picker-item" type="button" key={agent.key} onClick={() => void addAgent(agent)} disabled={!!addingAgentKey}>
                              <span className="agent-picker-icon"><Bot size={14} /></span>
                              <span className="agent-picker-copy">
                                <span className="agent-picker-name">{agent.name}</span>
                                <span className="agent-picker-description">{agent.description || agent.key}{agent.capabilities?.length ? ` · ${agent.capabilities.join(" · ")}` : ""}</span>
                              </span>
                              {addingAgentKey === agent.key && <LoaderCircle size={13} className="spin" />}
                            </button>
                          ))}
                        </div>
                      )}
                      {agentListMessage && <div className="agent-picker-message">{agentListMessage}</div>}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              {members
                .filter((m) => m.principalType === "ASSISTANT")
                .map((member) => (
                  <div className="member-row" key={member.id}>
                    <Avatar name={member.displayName} assistant url={member.avatarKey} onClick={() => setProfileMember(member)} />
                    <div>
                      <div className="member-name">{member.displayName}</div>
                      <div className="member-role">{roleLabel(member)}</div>
                    </div>
                    <i className="member-state" />
                    {canManageAgents && <button type="button" className="member-remove" aria-label={`从房间移除 ${member.displayName}`} title="从房间移除 Agent" onClick={() => void removeAgent(member)}><Trash2 size={13} /></button>}
                  </div>
                ))}
            </div>
          </aside>
        </main>
      </div>
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}><DialogContent><DialogHeader><DialogTitle>申请加入聊天室</DialogTitle><DialogDescription>输入聊天室 ID 或 slug，提交后等待管理员审核。</DialogDescription></DialogHeader><div className="form-stack"><input className="text-input" placeholder="聊天室 ID 或 slug" value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)} /><textarea className="text-input" placeholder="申请理由（可选）" value={joinReason} onChange={(e) => setJoinReason(e.target.value)} /><button type="button" className="primary-button" onClick={() => void submitJoinRequest()}>提交申请</button></div></DialogContent></Dialog>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}><DialogContent><DialogHeader><DialogTitle>邀请成员</DialogTitle><DialogDescription>输入用户 ID，邀请其加入当前聊天室。</DialogDescription></DialogHeader><div className="form-stack"><input className="text-input" placeholder="用户 ID" value={inviteUserId} onChange={(e) => setInviteUserId(e.target.value)} /><button type="button" className="primary-button" onClick={() => void inviteMember()}>发送邀请</button></div></DialogContent></Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent><DialogHeader><DialogTitle>聊天室设置</DialogTitle><DialogDescription>{activeRoom.name}</DialogDescription></DialogHeader><div className="settings-summary"><div><span>聊天室 ID</span><code>{activeRoom.id}</code></div><div><span>成员数</span><strong>{activeRoom.memberCount ?? members.length}</strong></div><div><span>Agent 自动调度</span><strong>{supervisor?.enabled ? "已开启" : "已关闭"}</strong></div></div></DialogContent></Dialog>
      <Dialog open={!!profileMember} onOpenChange={(open) => !open && setProfileMember(null)}>
        <DialogContent className="profile-dialog">
          {profileMember && (
            <>
              <DialogHeader>
                <DialogTitle>个人信息</DialogTitle>
                <DialogDescription>房间成员资料</DialogDescription>
              </DialogHeader>
              <div className="profile-dialog-body">
                <button
                  type="button"
                  className={`profile-dialog-avatar${profileMember.avatarKey ? " can-preview" : ""}`}
                  onClick={() => profileMember.avatarKey && setPreviewImage(profileMember.avatarKey)}
                  aria-label={profileMember.avatarKey ? "查看头像大图" : "头像"}
                >
                  <Avatar name={profileMember.displayName} assistant={profileMember.principalType === "ASSISTANT"} url={profileMember.avatarKey} />
                </button>
                <div>
                  <div className="profile-dialog-name">{profileMember.displayName}</div>
                  <div className="profile-dialog-role">{roleLabel(profileMember)}</div>
                  <div className="profile-dialog-type">{profileMember.principalType === "ASSISTANT" ? "聊天室 Agent" : "聊天室成员"}</div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {previewImage && (
        <div
          className="image-lightbox"
          onClick={() => setPreviewImage(null)}
        >
          <div className="image-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="image-lightbox-close"
              aria-label="关闭"
              onClick={() => setPreviewImage(null)}
            >
              <X size={16} />
            </button>
            <img src={previewImage} alt="图片预览" />
          </div>
        </div>
      )}
    </div>
  );
}
