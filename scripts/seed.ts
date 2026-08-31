import { PrismaClient, UserRole, PrincipalType, RoomRole, AgentKind, ModelProviderType } from "@prisma/client";
import argon2 from "argon2";
import { PERSONAS } from "../src/lib/ai/personas.ts";
import { AGENT_AVATARS, AGENT_COLORS, DEFAULT_AGENT_AVATAR } from "../src/lib/ai/avatars.ts";

const db = new PrismaClient();

const PERMISSIONS: Array<{ key: string; description: string }> = [
  { key: "room.create", description: "创建房间" },
  { key: "room.archive", description: "归档房间" },
  { key: "agent.add_to_room", description: "向房间添加 Agent" },
  { key: "agent.manage", description: "管理 Agent" },
  { key: "model.manage", description: "管理模型配置" },
  { key: "skill.manage", description: "管理 Skills" },
  { key: "user.manage", description: "管理用户" },
  { key: "role.manage", description: "管理角色与权限" },
  { key: "admin.access", description: "进入后台管理" },
];

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin-password-change-me";
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "demo-password-change-me";
  const [adminHash, demoHash] = await Promise.all([
    argon2.hash(adminPassword, { type: argon2.argon2id }),
    argon2.hash(demoPassword, { type: argon2.argon2id }),
  ]);
  const admin = await db.user.upsert({ where: { email: "admin@example.com" }, update: { passwordHash: adminHash, displayName: "管理员", role: UserRole.ADMIN, status: "ACTIVE" }, create: { email: "admin@example.com", passwordHash: adminHash, displayName: "管理员", role: UserRole.ADMIN } });
  const demo = await db.user.upsert({ where: { email: "demo@example.com" }, update: { passwordHash: demoHash, displayName: "演示用户" }, create: { email: "demo@example.com", passwordHash: demoHash, displayName: "演示用户" } });

  // Permissions
  for (const perm of PERMISSIONS) {
    await db.permission.upsert({ where: { key: perm.key }, update: { description: perm.description }, create: perm });
  }
  const allPerms = await db.permission.findMany();

  // System roles
  const adminRole = await db.role.upsert({ where: { name: "管理员" }, update: { isSystem: true, description: "拥有全部管理权限" }, create: { name: "管理员", description: "拥有全部管理权限", isSystem: true } });
  const memberRole = await db.role.upsert({ where: { name: "成员" }, update: { isSystem: true, description: "普通聊天成员" }, create: { name: "成员", description: "普通聊天成员", isSystem: true } });
  for (const perm of allPerms) {
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } }, update: {}, create: { roleId: adminRole.id, permissionId: perm.id } });
  }
  await db.user.update({ where: { id: admin.id }, data: { roleId: adminRole.id } });
  await db.user.update({ where: { id: demo.id }, data: { roleId: memberRole.id } });

  // Default model + agent (大聪明)
  const model = await db.model.upsert({
    where: { name: "本地默认" },
    update: {},
    create: { name: "本地默认", modelId: process.env.LOCAL_AI_MODEL ?? "local-model", baseUrl: process.env.LOCAL_AI_BASE_URL ?? "http://localhost:4000/v1", providerType: ModelProviderType.OPENAI_COMPATIBLE },
  });
  await db.agent.upsert({
    where: { key: "da-cong-ming" },
    update: { modelId: model.id, avatarKey: DEFAULT_AGENT_AVATAR, primaryColor: AGENT_COLORS[0], kind: AgentKind.CHAT },
    create: {
      key: "da-cong-ming",
      name: "大聪明",
      description: "聊天室通用助手，简洁清楚地用简体中文作答。",
      systemPrompt: "你是聊天室助手“大聪明”。用简体中文简洁、清楚地回复，只根据当前房间上下文作答。",
      avatarKey: DEFAULT_AGENT_AVATAR,
      primaryColor: AGENT_COLORS[0],
      modelId: model.id,
      kind: AgentKind.CHAT,
    },
  });

  // Hidden room supervisor: it is configured on rooms, never added as a member.
  const supervisor = await db.agent.upsert({
    where: { key: "room-supervisor" },
    update: { modelId: model.id, kind: AgentKind.SUPERVISOR, enabled: true, capabilities: [] },
    create: {
      key: "room-supervisor",
      name: "房间总管",
      description: "仅负责判断是否需要交给专职 Agent 处理。",
      systemPrompt: "你是房间总管，只输出结构化路由决策，不直接回复用户。",
      modelId: model.id,
      kind: AgentKind.SUPERVISOR,
      capabilities: [],
      enabled: true,
    },
  });

  // Image agents are seeded without a model so a local seed never requires an image provider.
  const imageAgents = [
    { key: "image-comic", name: "漫画师", capability: "image.comic" },
    { key: "image-portrait", name: "人像师", capability: "image.portrait" },
    { key: "image-landscape", name: "风景师", capability: "image.landscape" },
  ];
  for (const imageAgent of imageAgents) {
    await db.agent.upsert({
      where: { key: imageAgent.key },
      update: { name: imageAgent.name, kind: AgentKind.IMAGE, capabilities: [imageAgent.capability], modelId: null, enabled: true },
      create: { key: imageAgent.key, name: imageAgent.name, description: `${imageAgent.name}，专注于 ${imageAgent.capability}。`, systemPrompt: `你是${imageAgent.name}。`, kind: AgentKind.IMAGE, capabilities: [imageAgent.capability], enabled: true },
    });
  }

  // 预制人格库：写入 Agent 表，可直接加入房间，也可作为新建 Agent 的预设。
  for (const [index, persona] of PERSONAS.entries()) {
    const avatarKey = AGENT_AVATARS[index % AGENT_AVATARS.length].src;
    const primaryColor = AGENT_COLORS[(index + 1) % AGENT_COLORS.length];
    await db.agent.upsert({
      where: { key: persona.key },
      update: { name: persona.name, description: persona.description, systemPrompt: persona.systemPrompt, avatarKey, primaryColor, modelId: model.id, kind: AgentKind.CHAT, capabilities: [], enabled: true },
      create: { key: persona.key, name: persona.name, description: persona.description, systemPrompt: persona.systemPrompt, avatarKey, primaryColor, modelId: model.id, kind: AgentKind.CHAT, capabilities: [], enabled: true },
    });
  }

  const room = await db.room.upsert({ where: { slug: "welcome" }, update: { name: "欢迎" }, create: { name: "欢迎", slug: "welcome", createdById: admin.id } });
  await db.roomSupervisor.upsert({
    where: { roomId: room.id },
    update: { agentId: supervisor.id, enabled: true },
    create: { roomId: room.id, agentId: supervisor.id, enabled: true },
  });
  const memberships = [
    { principalType: PrincipalType.USER, userId: admin.id, roomRole: RoomRole.OWNER },
    { principalType: PrincipalType.USER, userId: demo.id, roomRole: RoomRole.MEMBER },
    { principalType: PrincipalType.ASSISTANT, assistantKey: "da-cong-ming", roomRole: RoomRole.MEMBER },
  ];
  for (const membership of memberships) {
    const exists = await db.roomMember.findFirst({
      where: { roomId: room.id, userId: membership.userId, assistantKey: membership.assistantKey, leftAt: null },
    });
    if (!exists) await db.roomMember.create({ data: { roomId: room.id, ...membership } });
  }
  console.log(`已写入用户、角色/权限、模型/Agent 和房间 ${room.slug}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
