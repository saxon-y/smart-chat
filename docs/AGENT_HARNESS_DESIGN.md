# Smart Chat Agent Harness 设计方案

日期：2026-09-01  
状态：设计草案  
参考版本：Multica `main@11861145abc59a0d39c8c8f24ad837d4584e664f`

## 1. 文档目的

本文定义 Smart Chat 的 Agent Harness 架构。Harness 负责把聊天室中的用户意图转换为可执行、可恢复、可审计的 Agent 任务，并统一调度内建模型、MCP 工具以及 Claude Code、Codex 等外部 Agent Runtime。

本文讨论的是 Agent 上下文和执行调度工程，不是模型质量评测 Harness。

Smart Chat Harness 的定位是：

> 面向聊天室的多 Agent Runtime Control Plane。

它不重新实现 Claude Code 或 Codex 的全部内部推理循环，而是定义任务、上下文、Skill、工具权限、运行协议和结果协议，再将执行交给可替换的 Runtime。自建 Runtime 的循环、Sidecar、输出核验与恢复也属于同一套 Harness，细节见 `docs/SELF_HOSTED_AGENT_RUNTIME_DESIGN.md`。Context Planner 的 pinned block、工具调用与结果成对保留、Skill hash 对所有 Runtime 具有规范约束力。

## 2. Multica 的关键设计结论

Multica 的核心不是自建统一模型循环，而是将外部 Agent CLI 作为 Runtime，通过控制面和本地 daemon 进行治理。

值得借鉴的设计包括：

1. 使用统一 `Backend.Execute` 接口适配不同 Agent CLI，执行结果通过消息流和最终结果流返回。
2. 服务端负责排队、认领、状态和权限；daemon 负责本地工作目录、进程、上下文文件、MCP 和流式事件。
3. 上下文优先写入 Runtime 原生文件，如 `AGENTS.md`、`CLAUDE.md` 和 `QWEN.md`，只有不支持文件上下文的 Runtime 才内联系统提示词。
4. Skill 以 `SKILL.md` 加辅助文件组成 Bundle，并计算内容哈希，确保一次运行使用固定版本。
5. Remote MCP 固定管理员批准的工具输入 schema digest；服务端工具契约发生漂移时拒绝执行。
6. MCP 凭据不进入任务包，由 daemon 在执行时按引用即时解析。
7. 每个任务使用独立工作目录；session 和 memory 根据 Agent、会话来源进行稳定分片。
8. 取消外部 Agent 时终止完整进程组，避免工具或 MCP 子进程泄漏。
9. Runtime 原生多 Agent 默认关闭，跨 Agent 协作通过独立任务、明确交接和阶段 barrier 建模。
10. Multica 本身不保证文件系统沙箱。真正的隔离边界需要专用 OS 用户、容器或虚拟机。

Smart Chat 应借鉴这些执行边界，但不能照搬其 Issue/代码任务模型。Smart Chat 的上下文主键是 `Room + Message Thread + AiRun`，交付物不仅是代码，也包括文本、图片、文档和业务工具副作用。

## 3. 设计目标

- 同时支持内建模型 Runtime 和外部 CLI Runtime。
- Runtime 可替换，聊天室业务不感知 Claude、Codex、Gemini 等厂商协议。
- 上下文可选择、可压缩、可版本化，不直接拼接整个房间历史。
- Skill 可解析、可固定版本、可验证依赖、可追踪来源。
- MCP 工具可发现，但只有经过策略批准的工具才能执行。
- 每次任务可暂停、恢复、取消、重试和审计。
- 多 Agent 委派使用父子任务，不依赖不可观测的进程内 subagent。
- 工具调用和外部副作用遵守房间权限与审批策略。
- Runtime 断线或进程崩溃后，可以明确恢复或披露上下文连续性丢失。

## 4. 非目标

- 不在第一阶段实现完整通用编码 IDE。
- 不允许模型自行决定权限边界。
- 不把 MCP Server 视为天然可信来源。
- 不把所有聊天室消息、Skill 和工具 schema 无限制放入上下文。
- 不依赖单个 Node.js 进程承载所有长任务。
- 不将 Provider API Key、MCP Token 或用户 Cookie写入任务上下文。

## 5. 总体架构

```text
┌────────────────── Smart Chat Control Plane ──────────────────┐
│ Room / Message / Member / Permission                         │
│ Supervisor / Scheduler / AiRun / Audit / Artifact            │
│ Context Planner / Skill Registry / MCP Registry              │
└──────────────────────────┬────────────────────────────────────┘
                           │ TaskEnvelope
              ┌────────────┴────────────┐
              │                         │
┌─────────────▼──────────────┐  ┌───────▼──────────────────────┐
│ Embedded Runtime Worker    │  │ Smart Chat Runtime Daemon   │
│ OpenAI/Gemini + Tool Loop  │  │ Local / Container / VM      │
│ Chat / Image / Business    │  │ Claude / Codex / MCP / CLI  │
└─────────────┬──────────────┘  └───────┬──────────────────────┘
              │                         │
              └────────────┬────────────┘
                           ▼
                 RunEvent / Artifact / Result
```

架构分为两个平面：

### 5.1 控制面

由现有 Next.js API、PostgreSQL、Prisma 和 Worker 承担：

- 将消息转换为 `AiRun`。
- Supervisor 选择目标 Agent。
- 冻结 Agent、Runtime、Skill、MCP 和策略快照。
- 分配执行预算和并发额度。
- 调度、认领、租约、重试、取消。
- 保存运行事件、Artifact、审计和最终消息。
- 验证房间成员权限和管理员审批。

### 5.2 执行面

执行面包含两类 Runtime：

- Embedded Runtime：运行在 Smart Chat Worker 中，适合聊天、图片生成和短时 MCP function calling。
- Daemon Runtime：运行在独立机器、容器或虚拟机中，适合 Claude Code、Codex、终端、文件系统和长任务。

Daemon 不直接连接业务数据库，只使用控制面签发的短期任务凭证访问 API。

## 6. Runtime 抽象

```ts
interface AgentRuntime {
  capabilities(): Promise<RuntimeCapabilities>;
  execute(task: TaskEnvelope): Promise<RuntimeSession>;
  resume(task: ResumeEnvelope): Promise<RuntimeSession>;
  cancel(runId: string): Promise<void>;
}

interface RuntimeSession {
  events: AsyncIterable<RunEvent>;
  result: Promise<RunResult>;
}
```

Runtime Adapter 负责：

- 将统一任务协议转换成厂商或 CLI 协议。
- 准备 Runtime 原生上下文目录。
- 解析流式文本、thinking、tool call、usage 和最终结果。
- 保存或恢复 Runtime session ID。
- 处理取消、超时、无活动 watchdog 和进程树清理。
- 将厂商错误转换为统一错误码。

第一批 Runtime：

| Runtime | 类型 | 用途 |
| --- | --- | --- |
| OpenAI Compatible | Embedded | 文本 Agent、Supervisor、MCP tool calling |
| Gemini Images | Embedded | 图片生成 |
| Codex App Server | Daemon | 编码和工作区任务 |
| Claude Code Stream JSON | Daemon | 编码、工具和 MCP 任务 |

## 7. TaskEnvelope

控制面必须发送版本化任务包，而不是只发送一段 Prompt。

```ts
type TaskEnvelope = {
  protocolVersion: "smart-chat-harness/v1";
  runId: string;
  parentRunId?: string;
  roomId: string;
  triggerMessageId: string;
  objective: string;
  agent: AgentSnapshot;
  runtime: RuntimeSnapshot;
  contextBundle: ContextBundle;
  skillBundle: SkillBundle;
  mcpBundle: McpBundle;
  policy: ExecutionPolicy;
  limits: ExecutionLimits;
  workspace?: WorkspaceSpec;
};
```

所有快照在任务 claim 时固化。后台修改 Agent Prompt、Skill 或 MCP 配置，不得静默改变正在运行或恢复中的任务。

任务包中禁止包含：

- Provider API Key 明文。
- MCP Token 明文。
- Session Cookie。
- 与当前房间无关的消息或成员信息。
- 管理后台密钥配置。

## 8. Context Planner

### 8.1 上下文来源

```text
安全策略
→ Harness Runtime 规则
→ Agent Persona
→ 当前任务
→ 激活 Skill
→ 明确引用的消息和附件
→ 最近相关消息
→ 房间摘要
→ 父任务结构化结果
→ 工具调用结果
```

### 8.2 Context Block

```ts
type ContentOrigin =
  | "system_policy"
  | "user"
  | "skill"
  | "tool"
  | "mcp"
  | "memory"
  | "retrieval"
  | "child_handoff";

type ContextBlock = {
  id: string;
  kind: "policy" | "agent" | "task" | "skill" | "message" |
        "memory" | "artifact" | "tool-result" | "handoff";
  origin: ContentOrigin;
  priority: number;
  tokenEstimate: number;
  content: string;
  pinned?: boolean;
  expiresAfterTurn?: number;
  sourceRef?: string;
};
```

系统策略、当前任务和已激活 Skill 为 pinned block。工具调用与工具结果必须成对保留。只有 `system_policy` 和 Planner 标记的用户目标具有指令效力；memory、retrieval、tool、mcp、skill 正文和 child_handoff 视为不可信证据，不得改变允许工具、host、预算或审批规则。

### 8.3 Context Bundle

```ts
type ContextBundle = {
  generation: number;
  objective: string;
  blocks: ContextBlock[];
  referencedArtifacts: ArtifactRef[];
  decisions: DecisionRecord[];
  unresolved: string[];
  digest: string;
};
```

### 8.4 Runtime 文件映射

Daemon 为每次任务生成：

```text
.run/
├── SYSTEM.md
├── AGENT.md
├── TASK.md
├── ROOM_CONTEXT.md
├── MEMORY.md
├── POLICY.json
├── skills/
├── attachments/
└── artifacts/
```

Runtime Adapter 再映射成原生入口：

| Runtime | 入口 |
| --- | --- |
| Codex | `AGENTS.md` 和 task-scoped `CODEX_HOME` |
| Claude Code | `CLAUDE.md` |
| Qwen | `QWEN.md` |
| Embedded | provider messages/context blocks |

写入 Runtime 文件必须使用受管理的 BEGIN/END marker，幂等更新 Harness 内容并保留用户原有文件内容。

### 8.5 压缩与外部化

超过预算时按顺序处理：

1. 删除重复 schema、过期状态和低价值日志。
2. 将历史转换为结构化摘要。
3. 将大型工具结果写入 Artifact，只保留摘要和引用。
4. 仍超限则阻断任务并返回 `CONTEXT_BUDGET_EXCEEDED`，不能静默丢弃安全策略。

禁止用滑动窗口丢掉早期工具结果。工具调用与结果必须成对保留。压缩由代码执行，连续失败 3 次应阻断任务，不得在压缩循环中空转。默认只向模型注入 Skill 目录和工具名索引；完整正文与 schema 按需追加，不回写静态前缀。

## 9. Skill Bundle

### 9.1 Skill 目录协议

```text
skills/{skill-name}/
├── SKILL.md
├── manifest.json
├── references/
├── scripts/
└── assets/
```

### 9.2 Skill 数据结构

```ts
type LoadedSkill = {
  id: string;
  name: string;
  version: string;
  source: "builtin" | "workspace" | "plugin";
  instructions: string;
  files: SkillFile[];
  triggers: string[];
  capabilities: string[];
  requiredTools: string[];
  hash: string;
};

type SkillBundle = {
  version: 1;
  skills: LoadedSkill[];
  bundleHash: string;
};
```

### 9.3 Skill 加载流程

```text
确定性规则筛选候选
→ 模型或 Supervisor 选择
→ Agent/房间权限过滤
→ 完整读取 SKILL.md
→ 解析依赖文件
→ 路径边界检查
→ 校验 requiredTools
→ 计算文件和 Bundle SHA-256
→ 复制到 Runtime 原生 Skill 目录
```

运行和恢复始终绑定同一个 `skillBundleHash`。Skill 升级只能影响新任务。

Skill 包属于可执行供应链输入。外部导入的脚本和说明不能视为可信内容，必须标记来源，并在受限 Runtime 中执行。

## 10. MCP 设计

### 10.1 MCP Registry

MCP 是工具来源，不是权限来源。控制面维护：

- Server 配置和 revision。
- transport、endpoint 和允许域名。
- 管理员批准的工具列表。
- 每个工具的 input schema digest。
- 风险级别和 failure policy。
- secret reference，不存任务明文凭据。

```ts
type ApprovedMcpTool = {
  serverId: string;
  name: string;
  description: string;
  inputSchema: object;
  schemaDigest: string;
  risk: "READ" | "WRITE" | "DESTRUCTIVE";
};
```

### 10.2 Task-scoped MCP Broker

Daemon 为每个任务启动本地 broker：

```text
Runtime
→ 127.0.0.1 随机端口 + 随机 task token
→ Task MCP Broker
→ Remote MCP Server
```

Broker 负责：

- `tools/list` 发现。
- schema digest 比对。
- 凭据即时解析和注入。
- host allowlist。
- 调用次数、并发、超时和响应大小限制。
- 工具风险策略和审批。
- 统一审计和错误格式。

建议第一版限制：

```text
每任务最多 128 次 MCP 调用
最多 4 个并发调用
单次响应最多 1 MiB
默认超时 30 秒
```

### 10.3 Schema 漂移

```text
实际 tools/list
→ 计算 schema digest
→ 与 approved schema digest 比较
→ 不一致则拒绝该工具
```

不能因为工具名称相同就接受新的参数契约。

## 11. 工具权限与审批

模型只能提出工具调用，Harness 决定是否执行。

```text
模型请求 Tool Call
→ Tool Registry 查找
→ Skill 依赖检查
→ Agent capability 检查
→ 房间和用户权限检查
→ 参数边界检查
→ schema digest 检查
→ 风险等级检查
→ 自动执行或 WAITING_APPROVAL
```

```ts
type ExecutionPolicy = {
  allowedTools: string[];
  deniedTools: string[];
  approvalTools: string[];
  allowedHosts: string[];
  workspaceRoots: string[];
  maxCost?: number;
  toolDisclosure?: "index" | "full";
  skillDisclosure?: "catalog" | "full";
};
```

审批绑定：

```text
runId + toolCallId + argumentsDigest
```

审批后参数发生变化必须重新审批。永久授权不由 Runtime 自行创建。`toolDisclosure` 与 `skillDisclosure` 默认分别为 `index` 和 `catalog`；`full` 仅用于弱模型的显式例外，必须写在冻结的 Policy Snapshot 中，不能由模型在运行中请求。

## 12. Runtime Daemon

### 12.1 生命周期

```text
启动
→ 发现本机 Runtime
→ 注册 capabilities 和版本
→ 建立 WebSocket
→ 接收 wake signal
→ claim task
→ 获取短期凭证
→ 准备工作目录
→ 写入 Context/Skill/MCP Bundle
→ 启动 Runtime
→ 流式上传 RunEvent
→ 上传 Artifact 和最终结果
→ 清理或保留 workspace
```

WebSocket 用于唤醒、心跳、事件流和取消；定时轮询作为漏信和断线兜底。

### 12.2 工作目录

```text
.data/runtime-workspaces/{runtimeId}/{runId}/
```

```ts
type WorkspaceSpec = {
  mode: "ephemeral" | "durable";
  allowedPaths: string[];
  preserveOnFailure: boolean;
  maxBytes: number;
};
```

聊天和图片任务默认 ephemeral；编码和需要恢复的任务可使用 durable。

### 12.3 安全边界

Daemon 进程继承 OS 用户权限时，不构成安全沙箱。生产部署必须至少提供一种外部隔离：

- 专用低权限 OS 用户。
- 每任务容器。
- 独立 VM 或受控远程 Runtime。

高风险 Runtime 不允许在 Web 应用进程中直接启动。

### 12.4 取消与进程清理

取消外部 Runtime 时：

```text
关闭 stdin
→ SIGTERM 进程组
→ 等待 grace period
→ SIGKILL 进程组
→ 确认子进程和 MCP Server 已退出
```

只终止父 CLI 可能遗留工具和 MCP 子进程。

## 13. 事件协议

```ts
type RunEvent =
  | { type: "run.started"; sequence: number }
  | { type: "assistant.delta"; text: string; sequence: number }
  | { type: "thinking.summary"; text: string; sequence: number }
  | { type: "tool.started"; call: ToolCall; sequence: number }
  | { type: "tool.completed"; result: ToolResult; sequence: number }
  | { type: "artifact.created"; artifact: ArtifactRef; sequence: number }
  | { type: "approval.required"; request: ApprovalRequest; sequence: number }
  | { type: "run.blocked"; reason: string; sequence: number }
  | { type: "run.completed"; result: RunResult; sequence: number }
  | { type: "run.failed"; error: RunError; sequence: number };
```

`(runId, sequence)` 必须唯一，以支持断线重放和幂等消费。高频 delta 使用独立 `AgentRunEvent` 存储；现有 `OutboxEvent` 负责向 SSE/WebSocket 发布稳定事件。

工具结果统一为：

```ts
type ToolResult = {
  ok: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "json"; value: unknown }
    | { type: "artifact"; artifactId: string; mimeType: string }
  >;
  error?: { code: string; message: string; retryable: boolean };
  metadata: { durationMs: number; truncated?: boolean };
};
```

## 14. Session、Checkpoint 与恢复

每个 Runtime Adapter 可以返回 `runtimeSessionId`，但 session ID 只有在确认对应持久化数据存在后才能写入 checkpoint。

```ts
type AgentCheckpoint = {
  runId: string;
  eventSequence: number;
  runtimeSessionId?: string;
  contextGeneration: number;
  summary?: StructuredSummary;
  skillBundleHash: string;
  mcpBundleDigest: string;
};
```

恢复流程：

```text
读取 checkpoint
→ 验证 Runtime session 实体存在
→ 验证 Skill/MCP Bundle 未变
→ 尝试 resume
→ session 不可恢复时仅允许一次 fresh retry
→ 注入 continuity notice
→ 禁止把失效旧 session ID 写回新结果
```

连续性缺失必须作为事件和最终结果元数据披露，不能假装完整恢复。

## 15. 多 Agent 调度

不依赖 Codex/Claude 内部不可观测的 subagent fan-out。每次委派创建独立子 `AiRun`：

```text
Supervisor Run
├── Child Run: researcher
├── Child Run: designer
└── Child Run: comic-artist
```

父子任务通过结构化结果交接：

```ts
type RunResult = {
  status: "PROPOSED_COMPLETE" | "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELLED";
  summary: string;
  artifacts: ArtifactRef[];
  decisions: DecisionRecord[];
  followups: string[];
  verification?: {
    verifier: "SCHEMA" | "SERVER_TRUTH" | "REVIEWER_RUN";
    passed: boolean;
    evidenceRefs: string[];
  };
};
```

Runtime 最多申报 `PROPOSED_COMPLETE`。`COMPLETED` 只能由控制面在独立核验通过后投影。模型不能批准自己完成。

原则：

- 子 Agent 不共享完整父上下文。
- 父任务明确选择传递的 Context Block。
- 父任务等待阶段 barrier 后再汇总。
- 取消父任务默认向未完成子任务传播。
- 子任务继承预算上限，但拥有独立租约、事件流和审计。
- Runtime 原生多 Agent 默认关闭，只有协议和生命周期可观测时才能启用。

## 16. 数据模型建议

在现有 `AiRun`、`Artifact` 和 `OutboxEvent` 基础上增加：

```prisma
model AgentRuntime {
  id              String   @id @default(cuid())
  kind            String
  endpoint        String?
  capabilities    Json
  status          String
  version         String?
  lastHeartbeatAt DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model AgentRunEvent {
  id        String   @id @default(cuid())
  runId     String
  sequence  Int
  type      String
  payload   Json
  createdAt DateTime @default(now())

  @@unique([runId, sequence])
  @@index([runId, createdAt])
}

model AgentRunCheckpoint {
  id                String   @id @default(cuid())
  runId             String
  eventSequence     Int
  runtimeSessionId  String?
  contextGeneration Int
  summary           Json?
  createdAt         DateTime @default(now())

  @@index([runId, eventSequence])
}

model SkillRevision {
  id         String   @id @default(cuid())
  skillId    String
  version    Int
  bundleHash String
  manifest   Json
  content    Json
  createdAt  DateTime @default(now())

  @@unique([skillId, version])
  @@unique([bundleHash])
}

model McpConfigRevision {
  id            String   @id @default(cuid())
  configId      String
  revision      Int
  approvedTools Json
  schemaDigest  String
  createdAt     DateTime @default(now())

  @@unique([configId, revision])
}
```

`AiRun` 增加：

```text
runtimeId
runtimeKind
runtimeSessionId
contextGeneration
skillBundleHash
mcpBundleDigest
policyVersion
checkpointSequence
```

状态机增加：

```text
PREPARING
WAITING_APPROVAL
PAUSED
BLOCKED
```

## 17. 与现有代码的迁移边界

保留：

- `AiRun` 的租约、幂等、取消和重试。
- 房间 Supervisor 与 Agent capability 路由。
- Artifact 存储和访问控制。
- Provider URL 安全、密钥加密和限流。
- 房间成员、禁言、加入审核和管理员权限。

重构：

```text
当前 src/lib/ai/service.ts
  调度 + 直接 Provider 调用 + 结果落库

目标
  src/lib/ai/service.ts              只负责 orchestration
  src/lib/harness/runtime/           Runtime 调用与事件
  src/lib/harness/context/           上下文计划和压缩
  src/lib/harness/skills/            Skill Bundle
  src/lib/harness/mcp/               MCP Registry/Broker 协议
  runtime-daemon/                     外部 CLI 执行面
```

建议目录：

```text
src/lib/harness/
├── protocol/
├── runtime/
├── context/
├── skills/
├── mcp/
├── tools/
├── policy/
├── memory/
└── observability/

runtime-daemon/
├── src/runtime/
├── src/workspace/
├── src/mcp/
├── src/events/
└── src/security/
```

## 18. 实施阶段

### Phase 1：统一 Runtime 协议

- 定义 `TaskEnvelope`、`RunEvent`、`RunResult`。
- 定义 `AgentRuntime` 接口。
- 将现有 OpenAI/Gemini 适配为 Embedded Runtime。
- 将 `service.ts` 中 Provider 调用迁移到 Runtime Adapter。
- 建立 `AgentRunEvent` 和 sequence 幂等。

验收：现有聊天、Supervisor 和图片生成行为不变，但均通过统一 Runtime 协议执行。

### Phase 2：Context 与 Skill Bundle

- 实现 Context Block、预算和摘要。
- 实现 Skill 目录解析、依赖检查和 Bundle hash。
- 增加 Skill Revision。
- 实现 Runtime 原生上下文文件映射。
- 增加 context generation 和 checkpoint。

验收：相同 Bundle 和 Context generation 可以稳定重放；Skill 更新不影响运行中任务。

### Phase 3：MCP

- 使用官方 MCP SDK。
- 实现 MCP Registry 和配置 revision。
- 实现工具发现和 schema digest 固定。
- 实现凭据即时解析。
- 实现调用限制、工具策略和审批状态。

验收：未批准工具、schema 漂移、越权调用和响应超限均被 Harness 拒绝并审计。

### Phase 4：Runtime Daemon

- Runtime 注册、版本和心跳。
- WebSocket wake 与 HTTP claim。
- task-scoped workspace。
- Codex 和 Claude Adapter。
- session pin、resume、continuity notice。
- 取消、watchdog 和进程组清理。

验收：外部 CLI 任务可执行、断线重放、取消、恢复；Daemon 无数据库直连和长期业务密钥。

### Phase 5：多 Agent

- 父子 Run 和结构化 handoff。
- 并行子任务和阶段 barrier。
- 预算继承和取消传播。
- Supervisor 汇总。
- 默认关闭 Runtime 原生 multi-agent。

验收：父任务不会在子任务完成前提前结束；每个子任务拥有独立事件、租约、结果和审计链。

## 19. 核心验收标准

- Runtime 切换不修改聊天室业务代码。
- 每个执行可追溯到固定 Agent、Context、Skill、MCP 和策略版本。
- 未批准工具和 schema 漂移的 MCP 调用拦截率为 100%。
- 工具凭据不会进入任务包、模型上下文、事件日志和 Artifact。
- 重复事件不会产生重复消息或副作用。
- Runtime 进程取消后不残留子进程。
- session 不可恢复时明确记录 continuity gap。
- 父子任务的完成、取消和预算关系可查询。
- 高风险 Runtime 在独立用户、容器或 VM 中运行。

## 20. 关键决策

1. Smart Chat 是 Control Plane，不是另一个 Codex 实现。
2. Embedded 与 Daemon Runtime 共用同一任务和事件协议。
3. Context Planner 决定 Runtime 能看到什么。
4. Skill 使用不可变 Bundle 和内容哈希。
5. MCP 工具必须固定 schema digest，凭据即时解析。
6. 模型提出工具意图，Harness 决定是否执行。
7. 外部隔离环境才是文件系统和网络安全边界。
8. 多 Agent 使用独立父子任务，不依赖不可观测的原生 subagent。
9. session 恢复必须验证真实持久化数据存在。
10. 所有副作用必须可审计、可关联、可取消或明确标记不可撤销。

## 21. Runtime 决策与多 Agent 并行

### 21.1 决策问题

Smart Chat 可以使用两种执行策略：

1. 外部 Agent CLI Runtime：由 Codex、Claude Code 等成熟 CLI 承担 Agent Loop、文件、Shell、Git 和部分 MCP 能力。
2. 自建 Embedded Runtime：由 Smart Chat 自行实现模型循环、上下文、工具调用、MCP、持久化和恢复。

多 Agent 并行不应成为某个 Runtime 的内部能力。无论选择哪种执行策略，都由 Smart Chat Control Plane 创建和调度独立子 `AiRun`。

> 并行属于 Smart Chat Scheduler，不属于 Codex、Claude、Gemini 或其他单个 Runtime。

### 21.2 两种 Runtime 对比

| 维度 | 外部 Agent CLI Runtime | 自建 Embedded Runtime |
| --- | --- | --- |
| Agent Loop | CLI 内部实现 | Smart Chat 自行实现 |
| 并行方式 | 每个子 Run 独立进程/session | 每个子 Run 独立模型循环 |
| 工具能力 | 通常自带 Shell、文件、Git、MCP | 需要 Tool Registry 和执行器 |
| 上下文控制 | 通过 Runtime 原生文件间接控制 | 完全控制 Context Block |
| 启动和资源成本 | 高，需要进程和工作目录 | 较低，主要是 API、Token 和工具资源 |
| 可观测性 | 受 CLI 事件协议限制 | 可记录每轮模型与工具调用 |
| Session 恢复 | 依赖 CLI session 实体 | 基于数据库 checkpoint 自行恢复 |
| 工具审批 | 各 CLI 需要分别适配 | 可以统一实现 |
| 编码能力 | 成熟 | 从零实现成本极高 |
| 聊天、图片、业务 MCP | 偏重 | 更适合 |
| 安全边界 | 必须使用低权限用户、容器或 VM | 无 Shell 时风险较低 |

### 21.3 适用范围

外部 CLI 适合：

- 代码修改和仓库分析。
- Shell、Git、构建和测试。
- 需要成熟编码工具链的长任务。
- 私有代码必须留在指定机器的任务。

Embedded Runtime 适合：

- 聊天问答和内容生成。
- 图片生成。
- 业务数据查询和结构化分析。
- 受控 MCP 工作流。
- 低延迟、高并发的多 Agent 协作。

如果完全不使用外部 CLI，Smart Chat 还需自行实现模型 tool calling、Agent Loop、Context Planner、Tool Registry、MCP Client、Skills、审批、checkpoint 和恢复。若进一步提供编码能力，还需承担文件系统、Shell、Git、进程树和容器沙箱的建设成本。

### 21.4 统一并行模型

多 Agent 任务使用父子 Run：

```text
用户消息
   ↓
Supervisor Run
   ↓
Task Planner
   ↓
Execution Plan
   ├── Child Run A：调研
   ├── Child Run B：数据分析
   └── Child Run C：图片生成
           ↓
      Barrier 等待
           ↓
      Aggregator Run
           ↓
        最终回复
```

每个子 Run 必须拥有独立的：

- `AiRun` 记录和租约。
- Runtime session。
- Context Bundle。
- Skill/MCP Bundle 快照。
- Token、费用和工具预算。
- 事件序列和审计记录。
- 取消和失败状态。

子 Run 不应共享同一个模型消息数组、可写工作目录、CLI session 或工具调用计数器。

### 21.5 Execution Plan DAG

多 Agent 不只有“全部并行”一种模式，应使用有向无环图表达依赖：

```ts
type ExecutionPlan = {
  nodes: Array<{
    id: string;
    agentId: string;
    objective: string;
    dependsOn: string[];
    failurePolicy: "FAIL_FAST" | "CONTINUE" | "OPTIONAL";
    runtimeRequirements: RuntimeRequirements;
    budget: RunBudget;
  }>;
};
```

示例：

```text
research ───────┐
                ├──> writer ──> reviewer
data-analysis ──┘

image-generation ─────────────> final-assembler
```

节点仅在依赖满足后进入 `READY`，由 Scheduler 选择 Runtime 并原子 claim。

### 21.6 Barrier 和父任务状态

父任务不能在创建子任务后立即完成。建议父任务状态：

```text
PLANNING
DISPATCHING
WAITING_CHILDREN
AGGREGATING
COMPLETED
```

```ts
type BarrierPolicy =
  | { type: "ALL" }
  | { type: "ANY" }
  | { type: "QUORUM"; minimum: number }
  | { type: "REQUIRED"; runIds: string[] };
```

- 编码功能一般使用 `ALL`。
- 多来源调研可以使用 `QUORUM`。
- 多 Provider 竞速可以使用 `ANY`。
- 辅助图片等非关键结果可以标记为 `OPTIONAL`。

Aggregator 只读取子任务结构化结果，不读取全部执行日志：

```ts
type ChildRunResult = {
  summary: string;
  facts: Array<{ value: string; sourceRef?: string }>;
  decisions: DecisionRecord[];
  artifacts: ArtifactRef[];
  warnings: string[];
  unresolved: string[];
};
```

### 21.7 并发控制

禁止直接对任意数量的子任务执行无界 `Promise.all`。Scheduler 应实现多维配额：

```ts
type ConcurrencyPolicy = {
  global: number;
  perRoom: number;
  perUser: number;
  perAgent: number;
  perProvider: number;
  perRuntime: number;
  perMcpServer: number;
};
```

首版建议：

```text
全局 Embedded Run：20
每房间：4
每用户：3
每图片 Provider：2
每 MCP Server：4
每台 Daemon CLI：2 至 4
Supervisor：每房间串行 1
```

实际值应由压测和 Provider 配额确定。

### 21.8 外部 CLI 并行的特殊约束

每个子任务启动独立进程和 Runtime session，不使用 CLI 内部不可观测的 subagent：

```text
Parent Run
├── Codex Process A / Workspace A
├── Claude Process B / Workspace B
└── Codex Process C / Workspace C
```

编码任务不能共享可写 checkout。应为每个子任务创建独立 worktree：

```text
repository
├── worktree/run-a
├── worktree/run-b
└── worktree/run-c
```

由单独的 Integrator Run 完成 diff 收集、冲突解决、构建和测试。文件所有权可以降低冲突，但不能代替最终集成验证。

### 21.9 Embedded Runtime 并行的特殊约束

Embedded Runtime 的主要约束不是进程数，而是：

- Provider 请求和 Token 配额。
- MCP Server 并发限制。
- 数据库连接和 Worker 容量。
- 图片生成费用和延迟。
- 工具写操作的幂等性。

Agent 并发限制与 MCP 并发限制必须分开。例如可以同时运行 8 个 Agent，但 CRM MCP 只允许 2 个并发调用。

### 21.10 预算分配

父任务创建子任务前分配预算：

```ts
type RunBudget = {
  maxTokens: number;
  maxCost: number;
  maxTurns: number;
  maxToolCalls: number;
  deadlineAt: string;
};
```

示例：

```text
父任务预算：100
├── 规划：10
├── 调研 Agent：25
├── 数据 Agent：20
├── 图片 Agent：25
└── 汇总：20
```

子任务不能自行扩大预算。未使用预算可以在子任务终态后回收，但不应让并行任务竞争一个无事务保护的动态余额。

### 21.11 故障策略

`FAIL_FAST`：任一必要子任务失败，取消其余未完成子任务并使父任务失败。

`CONTINUE`：保留成功结果，等待其他子任务，汇总时标记部分失败。

`OPTIONAL`：子任务失败只记录 warning，不阻断父任务。

允许切换 Runtime 的故障：

- Runtime 离线。
- Runtime 版本不兼容。
- Session 不可恢复。
- 主 Runtime 持续不可用或达到熔断阈值。

不允许通过切换 Runtime 自动重试：

- 权限或内容审核拒绝。
- 用户取消。
- Skill/MCP schema 校验失败。
- 非幂等写工具已执行但结果未知。

结果未知的写操作必须进入 `BLOCKED` 并等待人工确认，防止重复付款、发送、创建或删除。

### 21.12 取消传播

取消父任务时：

```text
父任务进入 CANCEL_REQUESTED
→ 向所有非终态子任务传播
→ Embedded Runtime 中止 Provider/Tool 调用
→ Daemon Runtime 终止进程组和 MCP 子进程
→ 等待或超时回收子任务
→ 父任务进入 CANCELLED
```

已经产生不可撤销副作用的子任务不能被描述为“已回滚”，只能记录实际完成状态和补偿建议。

### 21.13 推荐决策

Smart Chat 采用混合 Runtime：

```text
Supervisor、聊天、图片、业务 MCP
→ 自建 Embedded Runtime

代码修改、终端、Git、复杂工作区任务
→ 外部 Agent CLI Runtime
```

典型混合执行计划：

```text
产品需求任务
├── Embedded Research Agent
├── Embedded UX Agent
├── Codex Daemon Backend Agent
├── Claude Daemon Frontend Agent
└── Embedded Reviewer/Aggregator
```

当前项目应优先完成 Embedded Runtime 的 Agent Loop、Context、Skills、MCP 和多 Agent DAG；同时保留外部 Runtime Adapter 接口，等出现明确编码任务需求后接入 Codex/Claude Daemon。

最终职责划分：

```text
Agent 决定角色
Planner 生成任务 DAG
Policy 限定能力和风险
Scheduler 选择 Runtime
Runtime 独立执行
Aggregator 汇总结果
```

## 22. Multica 参考资料

- [项目概览](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/README.md)
- [系统架构](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/apps/docs/content/docs/developers/architecture.mdx)
- [Agent Backend 接口](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/pkg/agent/agent.go#L17)
- [Daemon 任务执行](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/internal/daemon/daemon.go#L6750)
- [Context 与 Runtime 文件](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/internal/daemon/execenv/context.go#L121)
- [Skill Bundle Hash](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/pkg/skillbundle/hash.go)
- [Remote MCP 工具契约](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/pkg/remotemcp/types.go)
- [安全模型](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/apps/docs/content/docs/security-model.mdx)
- [Skills](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/apps/docs/content/docs/skills.mdx)
- [Tasks 与恢复](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/apps/docs/content/docs/tasks.mdx)
- [Squads 与跨 Agent 协作](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/apps/docs/content/docs/squads.mdx)
