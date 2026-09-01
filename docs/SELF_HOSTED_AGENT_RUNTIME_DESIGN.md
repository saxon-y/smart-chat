# Smart Chat 自建 Agent Runtime 设计方案

日期：2026-09-01  
状态：方案设计（已按 `docs/SELF_HOSTED_AGENT_RUNTIME_BOOK_REVIEW.md` 修订）  
上游设计：`docs/AGENT_HARNESS_DESIGN.md`（Context Planner、成对工具结果、Skill hash、`WorkspaceSpec` 对本方案具有规范约束力，不是平行叙述）

## 1. 文档目的

本文定义 Smart Chat 不依赖 Codex、Claude Code 等外部 Agent CLI 时的自建 Agent Runtime。该 Runtime 负责模型推理循环、工具执行、MCP 接入、输出核验、暂停恢复、事件记录和预算控制。

Smart Chat 的 **Harness 跨两个平面**：控制面负责任务契约与治理；Runtime 负责单次 Run 内的 ReAct、策略执行、验证钩子和恢复。二者共用同一套 Task / Event / Result 协议。外部 CLI Runtime 也必须遵守这套协议。

这里的“自建”是自建运行时和治理协议，不是训练模型，也不是重写模型 Provider。模型能力仍通过 OpenAI-compatible、Gemini 或其他 Provider API 获得。Runtime 不自动改写 Policy、Skill 或评测门槛。

> 目标是建设一个由 Smart Chat 控制面驱动、**可验证完成**、可暂停恢复、可审计、Provider 无关的服务端 Agent Loop。上下文按静态前缀 + 轨迹 + 状态栏组装，工具按需披露，评估与执行协议同步建设。

## 2. 核心决策

1. Runtime 作为独立 Node.js Worker 部署，不运行在 Next.js API 请求生命周期内。
2. 每个 `AiRun` 是独立状态机；每次完整模型响应或工具结果构成一个持久化 Turn。
3. PostgreSQL 是执行状态的事实来源，队列只负责唤醒和削峰。
4. Runtime 只消费冻结后的 `TaskEnvelope`，不自行扩大上下文、权限或工具集合。
5. 模型只提出工具调用，Policy Engine 决定拒绝、执行或等待审批；Sidecar 只审查结构化调用，不看思考文本。
6. 外部副作用必须带稳定幂等键；结果未知时不得自动重放非幂等写操作。
7. 暂停和恢复发生在 Turn 边界，不承诺从中断的模型 HTTP 流中续传。运行中新用户消息排队到下一个 Turn 边界注入；明确取消仍用 AbortController。
8. 多 Agent 并行由控制面创建父子 `AiRun` 和 DAG，不隐藏在单个 Runtime Loop 内。
9. 第一阶段只提供受控工具和 MCP，不提供任意 Shell、Git 或宿主文件系统访问。`WorkspaceSpec` 与取消杀进程组语义在 Phase 1 即冻结。
10. **完成权在控制面或独立验证器。** Runtime 最多申报 `PROPOSED_COMPLETE`；`COMPLETED` 只能在核验通过后由控制面投影。模型不能批准自己完成。
11. **BUILD_INPUT 遵守静态前缀 / 只追加轨迹 / 代码维护的状态栏。** 时间戳、预算余量和工具计数不得写入 system 前缀。
12. **Skill 与 MCP schema 冻结版本，但按需注入。** 冻结的是目录 hash 与 digest；默认只把 name / description 和工具名索引交给模型。弱模型可显式声明 `toolDisclosure: "full"`。

## 3. 现状与迁移边界

现有系统可复用：

- `AiRun` 的 claim、租约、重试、取消和父子关系。
- 房间 Supervisor、Agent capability 与成员版本校验。
- Provider URL 安全校验、密钥解密、Artifact 存储和 Outbox。
- 聊天消息、房间权限和 SSE 事件发布。

当前 `src/lib/ai/service.ts` 同时承担调度、上下文拼接、Provider 调用和结果落库，文本路径是单次 `chat/completions`。目标是将其拆成控制面编排与独立执行面：

```text
现状
Next.js Worker -> claim AiRun -> Provider -> 写消息

目标
Control Plane -> 冻结 TaskEnvelope -> Runtime Queue
                                         |
                                 Runtime Worker
                                         |
          Model Loop <-> Policy <-> Sidecar <-> Tool/MCP
                 |                              |
                 +-> VERIFY_OUTPUT -------------+
                                         |
                       Event / Checkpoint / Proposed Result
                                         |
                         Control Plane 核验并投影 COMPLETED
```

## 4. 总体架构

```text
+------------------------ Control Plane -------------------------+
| Chat API | Supervisor | Context Planner | Skill Registry       |
| Policy Snapshot | Scheduler | Approval API | Output Verifier   |
| Result Projector | Eval Harness                                |
+-----------------------------+----------------------------------+
                              | TaskEnvelope / wake signal
                              v
+-------------------- Self-hosted Runtime Plane -----------------+
| Dispatcher -> Lease Guard -> Agent Loop -> Provider Adapter    |
|                                |        -> Policy Engine        |
|                                |        -> Sidecar Gate         |
|                                |        -> Tool Executor        |
|                                |        -> MCP Gateway          |
|                                |        -> Input Assembler      |
|                                +--------> Event/Checkpoint      |
+-----------------------------+----------------------------------+
                              |
                              v
+------------------------- Data Plane ----------------------------+
| PostgreSQL: runs, turns, events, calls, checkpoints, approvals |
| Object Storage: attachments, large results, artifacts          |
| Queue/Notify: wake-up only                                     |
+---------------------------------------------------------------+
```

### 4.1 Control Plane

控制面负责业务决策：创建 `AiRun`；固化 Agent、模型、Context、Skill、MCP、策略和预算；调度父子 Run；处理审批、取消和重试；核验 Runtime 申报的完成提议；将最终 `RunResult` 投影成聊天室消息。评测集与金样轨迹由控制面的 Eval Harness 持有，Runtime 不修改评测门槛。

### 4.2 Runtime Plane

执行面负责协议执行：原子 claim 与续租；从 checkpoint 恢复；按 `ModelInputLayout` 组装输入；调用模型；规范化输出和 tool calls；执行策略判定、Sidecar 门控与工具调用；顺序写入事件、Turn、checkpoint 和完成提议；响应取消、超时、预算耗尽和租约丢失。

Runtime 不直接访问聊天室业务写表。只读真值查询（订单状态、成员身份、资源归属）通过受控内部 API 或只读数据库角色完成，供 Policy Engine 和 Output Verifier 使用。

### 4.3 Data Plane

PostgreSQL 保存可恢复的结构化状态，对象存储保存附件、超大工具响应和生成物。Redis、PostgreSQL `LISTEN/NOTIFY` 或消息队列可用于唤醒 Worker，但必须保留数据库扫描兜底。

## 5. 代码模块

```text
src/lib/harness/
├── protocol/           # TaskEnvelope、RunEvent、RunResult、ContentPart.origin
├── context/            # Context Planner、预算、摘要、provenance
├── skills/             # Skill Bundle 和 revision
├── policy/             # 权限、风险、审批判定、真值查询
├── verify/             # 输出契约、服务端真值、Reviewer Run
├── eval/               # 金样轨迹、注入回归、模型替换
└── scheduler/          # DAG、配额、runtime 选择、子任务预算

runtime/
├── src/worker/         # claim、续租、取消、watchdog
├── src/loop/           # Agent Loop 状态机
├── src/input/          # ModelInputLayout、状态栏、按需加载账本
├── src/providers/      # Provider Adapter、idle watchdog
├── src/tools/          # Tool Registry 和执行器
├── src/sidecar/        # 结构化工具调用审查
├── src/mcp/            # MCP Gateway
├── src/checkpoint/     # checkpoint 与恢复
├── src/events/         # 事件持久化和 delta 聚合
└── src/security/       # secret、网络、内容边界
```

## 6. Runtime 核心组件

### 6.1 Dispatcher 与租约

Dispatcher 只选择状态为 `READY` 或到期 `RETRY_WAIT`、capability 满足且未超过多维配额的 Run。claim 使用事务和 compare-and-set 更新 `leaseGeneration`。后续写操作必须携带 `runId + owner + leaseGeneration`，租约丢失的 Worker 不得提交结果。

流式连接除请求超时外，必须有独立的 idle watchdog：连续 15–20 秒没有 `text.delta` / `thinking.summary` / `tool.arguments.delta` 即判定静默卡死并中止该次 generate。租约续租不得让卡死的 Worker 一直占着 Run。

### 6.2 Agent Loop Engine

Agent Loop 是不直接访问聊天室业务写表的状态机：

```text
LOAD_TASK -> DRAIN_INBOUND -> BUILD_INPUT -> MODEL_REQUEST -> MODEL_RESPONSE
                                                                  | tools
                                                                  v
                                            AUTHORIZE_TOOLS -> DENY / WAITING_APPROVAL / SIDECAR / EXECUTE_TOOLS
                                                                  |
                                            APPEND_RESULTS -> CHECK_LIMITS -> CHECKPOINT -+
                                                                  |
                                                                  | no tools / 模型声称完成
                                                                  v
                                            VERIFY_OUTPUT -> PROPOSE_COMPLETE | CONTINUE | BLOCKED
```

`FINALIZE` 只提交完成提议和已发生副作用的账本，不把 Run 标为房间可见的成功。

终止与转移条件：

- `VERIFY_OUTPUT` 通过：进入 `PROPOSED_COMPLETE`，等待控制面投影。
- 达到最大 Turn、Token、费用、工具次数或总耗时：失败或阻塞，不得因“模型说做完了”而放行。
- 用户取消、权限撤销、租约丢失。
- 进入审批等待、需要新输入、或不可重试错误。
- 压缩连续失败 3 次：`BLOCKED`，禁止在压缩循环里空转。

运行中事件只在 Turn 边界消费（`DRAIN_INBOUND`）：

| 事件 | 策略 |
| --- | --- |
| 新用户消息 | 排队，在当前模型 HTTP 结束后注入为新的 user turn |
| 取消 | AbortController 立即发出；工具在安全点停止；已提交副作用必须披露 |
| 暂停 / 审批结果 | 释放租约，保留 checkpoint，唤醒后从 Turn 边界继续 |

第一阶段不做并行式「边跑边聊」，避免过早把一致性模型打复杂。

### 6.3 Provider Adapter

统一接口屏蔽各 Provider 的消息与 tool calling 差异：

```ts
interface ModelProvider {
  capabilities(): ProviderCapabilities;
  generate(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

type ModelEvent =
  | { type: "text.delta"; text: string }
  | { type: "thinking.delta"; text: string }
  | { type: "thinking.summary"; text: string }
  | { type: "tool.arguments.delta"; callId: string; text: string }
  | { type: "response.completed"; response: ModelResponse; usage: Usage }
  | { type: "response.failed"; error: RuntimeError };
```

Adapter 仅处理请求转换、流式解析、请求超时、idle watchdog、Provider request ID、usage 和错误归一化，不处理业务权限。

思考过程按 Provider 策略完整入库（可对用户隐藏），恢复时按原 Turn 回放。若 Provider 不返回思考，记录 `thinkingContinuity = PROVIDER_OMITTED`，不得把它当成可丢字段 silently drop。`continuity` 必须区分「缺思考」与「缺工具结果」。

### 6.4 Tool Registry 与 Executor

```ts
type ToolDefinition = {
  id: string;
  version: string;
  inputSchema: object;
  schemaDigest: string;
  risk: "READ" | "WRITE" | "DESTRUCTIVE";
  idempotency: "READ_ONLY" | "KEYED" | "NON_IDEMPOTENT";
  concurrency: "forbidden" | "isolated";
  timeoutMs: number;
  maxResultBytes: number;
  specializationReason?:
    | "safety"
    | "permission-granularity"
    | "weak-model"
    | "no-sandbox-yet";
};

type ToolCategory =
  | "perception"
  | "action"
  | "collaboration"
  | "event-trigger"
  | "user-communication";
```

`concurrency` 默认 `forbidden`。`isolated` 表示同 Turn 并行失败只标记自身，不取消同批其它独立调用，也不上升到父级 Turn。写工具一律串行。

`specializationReason` 记录该能力为什么不是 Skill + 通用执行器，避免专用工具按业务线线性膨胀。

执行前依次验证：

1. 工具版本与 JSON Schema
2. Agent capability 与房间权限
3. 资源范围；**业务事实（金额、资源 ID、成员身份）以服务端只读查询为准，模型参数只作提示**
4. 审批绑定与预算
5. 幂等记录
6. 风险对应的 Sidecar / 人工审批（见 6.4.1）

大型结果写入 Artifact，模型上下文只保留摘要和引用。工具调用与工具结果必须成对保留；缺配对则修复或失败，禁止把残缺轨迹喂给模型。

Phase 2 提供受控 `notify_user`（用户沟通工具）：权限、频率和内容长度受限，不得绕过房间成员可见性。`spawn_subagent` 不是 Runtime 内工具，只允许走控制面 API。

### 6.4.1 Sidecar Gate

确定性策略解决「许不许可」；Sidecar 解决「参数表面合法、语义危险」。Sidecar 与主模型流式输出并行启动，但对被审查的那一次调用起门控作用。

| 风险 | 放行路径 |
| --- | --- |
| `READ` | 确定性策略通过即可执行 |
| `WRITE` | 确定性策略 + 轻量 Sidecar |
| `DESTRUCTIVE` 或 Sidecar / 策略不确定 | `WAITING_APPROVAL` |

Sidecar 输入只有 `{ toolId, version, arguments, risk, schemaDigest }`，**不读取用户原文、Skill 正文或模型 thinking**。超时（默认 500ms）的失败策略是升级审批，不是默认放行。

### 6.5 MCP Gateway

```text
Agent Loop -> Tool Registry -> MCP Gateway -> Remote MCP Server
```

Gateway 校验管理员批准的 `schemaDigest`，按 `secretRef` 即时解析凭据，限制 host、并发、超时、重定向和响应大小，并将 MCP 结果转换为统一 `ToolResult`。MCP 是工具来源，不是权限来源。MCP 返回值的 `origin` 为 `mcp`，无指令效力。

出站网络默认拒绝，仅放行该 MCP 的 host allowlist。接入或升级一组 MCP 时必须做致命三要素评审：是否同时具备私有数据访问、不可信内容暴露、以及对外通信。三者齐备则必须拆开权限、关掉出口、或强制审批，不能只靠提示词。

默认只向模型注入工具名索引；完整 schema 在首次调用前加载，追加到上下文末尾，不回写静态前缀。加载记录写入 Turn 事件，恢复时只重建已加载集合。

### 6.6 Checkpoint Writer

checkpoint 只在完整模型响应落库后、一组工具结果落库后、进入 `WAITING_APPROVAL` 前、进入 `PROPOSED_COMPLETE` 前以及 Run 结束前写入。流式 delta 不是恢复边界；连接中断时丢弃不完整响应，再按错误类别决定是否重试。

checkpoint 除既有 digest 外，必须保存：

- `loadedSkillIds` / `loadedToolSchemaIds`（已注入集合，不是整个 Bundle）
- `inboundSequence`（已消费的排队用户消息）
- 累计预算与工具计数（供状态栏由代码重算）

### 6.7 Input Assembler 与状态栏

`BUILD_INPUT` 必须按 `ModelInputLayout` 组装。上游 Context Planner 的 pinned block、工具调用与结果成对保留，在 Runtime 是硬约束。

```text
[静态前缀，跨 Turn 字节级稳定]
  系统策略 + Agent Persona + 冻结工具名索引 + 输出契约
[轨迹，只追加]
  已提交 Turn 与成对 Tool Result（大结果仅摘要 + artifactRef）
  已加载 Skill 正文 / 工具完整 schema（按加载顺序追加，不回写前缀）
[状态栏，每 Turn 由代码重写在末尾]
  now, turnIndex, budget remaining, tool counts, approval, children
```

冻结与注入拆开：

| 冻结（审计 / 恢复） | 注入（模型可见） |
| --- | --- |
| Skill 目录 hash、每个 Skill 的 revision | 默认只注入目录（name + description） |
| 批准的 MCP schemaDigest 集合 | 默认只注入工具名索引 |
| Policy Snapshot、预算、host allowlist | 始终注入，且 pinned |

状态栏由代码从 checkpoint 聚合，禁止再用一次 LLM 去总结当前状态。压缩禁止滑动窗口；不得丢弃成对的工具调用 / 结果；不得静默丢弃安全策略。连续压缩失败 3 次熔断为 `BLOCKED`。

`toolDisclosure: "full"` 是弱模型的显式例外，必须写在 Policy Snapshot 里，不能由模型在运行中请求。

### 6.8 Output Verifier

`VERIFY_OUTPUT` 独立于主模型自由文本：

1. `TEXT`：结构完整性（非空、未截断）和房间投影策略。
2. `JSON`：schema 校验，失败则带错误回 Loop，而不是当完成。
3. `ARTIFACT_SET`：检查声明的 Artifact 是否存在且可读。
4. 写工具已执行时：用只读真值查询对照业务状态（消息是否已发、记录是否已写），不信模型 summary。
5. 高风险或长程任务可再派独立 Reviewer Run：不同模型家族，只看结构化证据和 Artifact，不看主模型思考文本。闲聊默认跳过 Reviewer。

验证失败时 Loop 可继续（把失败当作工具结果），或在达到预算后 `BLOCKED`。验证通过后 Runtime 写入 `PROPOSED_COMPLETE`；控制面投影 `COMPLETED`。

## 7. 执行协议

### 7.1 TaskEnvelope

沿用 Harness v1，并增加自建 Runtime 字段：

```ts
type RuntimeTaskEnvelope = TaskEnvelope & {
  runtime: {
    kind: "SELF_HOSTED";
    adapter: string;
    adapterVersion: string;
    requiredCapabilities: string[];
  };
  workspace?: WorkspaceSpec;
  outputContract: {
    format: "TEXT" | "JSON" | "ARTIFACT_SET";
    schema?: object;
    verifier: "SCHEMA" | "SERVER_TRUTH" | "REVIEWER_RUN";
  };
  limits: {
    maxTurns: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxToolCalls: number;
    maxWallTimeMs: number;
    maxCostMicros?: number;
  };
  disclosure: {
    toolDisclosure: "index" | "full";
    skillDisclosure: "catalog" | "full";
  };
};
```

`WorkspaceSpec` 沿用上游 Harness：`mode`、`allowedPaths`、`preserveOnFailure`、`maxBytes`。聊天和图片默认 `ephemeral`；未来 `CODE_RUNTIME` 使用 `durable`。字段在无沙箱阶段也必须存在，避免 Phase 5 改建协议。

父任务声明 `limits` 上限；Planner 在上限内为每个子 Run 分配预算，并在 handoff 写明期望顺序（规划 / 执行 / 自检）。不得让所有子任务套用同一个全局 `maxTurns: 12`。

TaskEnvelope 在首次 claim 前计算 digest 并冻结。审批结果、新 Turn、已加载 Skill / schema 集合属于运行状态，不修改原任务快照。恢复时用快照 + 加载账本重建输入：已加载集合可复现；未加载的保持索引。Skill 正文变化若不在已加载集合中，不得改变前缀 digest。

### 7.2 ContentPart 与来源

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

type ContentPart = {
  type: "text" | "json" | "image_ref" | "artifact_ref";
  text?: string;
  origin: ContentOrigin;
  sourceRef?: string;
};
```

只有 `system_policy` 和经 Context Planner 标记的用户目标具有指令效力。Skill 正文是可加载的手册，不是可改权限的指令。memory / retrieval / mcp / tool / child_handoff 默认为不可信证据。写入记忆必须走独立审批或固定 schema 抽取，禁止把模型摘要直接当规则。

### 7.3 Turn

Turn 是最小可恢复推理单元：

```ts
type AgentTurn = {
  runId: string;
  index: number;
  inputDigest: string;
  prefixDigest: string;
  loadedSkillIds: string[];
  loadedToolSchemaIds: string[];
  providerRequestId?: string;
  assistantContent: ContentPart[];
  thinking?: ContentPart[];
  thinkingContinuity: "PRESENT" | "PROVIDER_OMITTED" | "DROPPED";
  finishReason: "STOP" | "TOOL_CALLS" | "LENGTH" | "CONTENT_FILTER";
  usage: Usage;
  startedAt: string;
  completedAt: string;
};
```

模型输入由冻结 Context Bundle、已提交 Turn、成对 Tool Result 和已加载集合确定性构建，不依赖 Worker 内存中的消息数组。`prefixDigest` 用于检测静态前缀是否被破坏（例如把时间戳写入 system）。

### 7.4 RunResult

```ts
type RunResult = {
  status:
    | "PROPOSED_COMPLETE"
    | "COMPLETED"
    | "BLOCKED"
    | "FAILED"
    | "CANCELLED";
  output: ContentPart[];
  summary: string;
  artifacts: ArtifactRef[];
  decisions: DecisionRecord[];
  followups: string[];
  usage: Usage;
  continuity: "FULL" | "REBUILT" | "GAP";
  thinkingContinuity: "PRESENT" | "PROVIDER_OMITTED" | "DROPPED";
  verification?: {
    verifier: "SCHEMA" | "SERVER_TRUTH" | "REVIEWER_RUN";
    passed: boolean;
    evidenceRefs: string[];
  };
};
```

Runtime 不得把 `status` 写成房间可见的 `COMPLETED`。控制面在验证记录存在且通过后投影。

## 8. 状态机

```text
PENDING -> PREPARING -> READY -> CLAIMED -> RUNNING
                                      |       |
                                      |       +-> WAITING_APPROVAL -> READY
                                      |       +-> PAUSED -> READY
                                      |       +-> RETRY_WAIT -> READY
                                      |       +-> WAITING_CHILDREN -> READY
                                      |       +-> VERIFYING -> PROPOSED_COMPLETE -> SUCCEEDED
                                      |       +-> BLOCKED
                                      |       +-> FAILED_FINAL
                                      +----------> CANCELLED
```

- `PREPARING`：控制面正在冻结快照，不可执行。
- `READY`：TaskEnvelope 完整且校验通过。
- `RUNNING`：仅当前租约持有者可写 Turn 和 Tool Call。
- `WAITING_APPROVAL`：释放计算资源与租约，但保留 checkpoint。
- `WAITING_CHILDREN`：父任务等待子 Run 在 barrier 汇合。
- `VERIFYING`：确定性核验或 Reviewer Run 进行中。
- `PROPOSED_COMPLETE`：Runtime 认为可交付，等待控制面投影。
- `PAUSED`：系统维护、管理员主动暂停，或排队中的用户消息尚未到达 Turn 边界时的短暂停顿由 `DRAIN_INBOUND` 处理，不必进入 `PAUSED`。
- `RETRY_WAIT`：仅用于确认可安全重试的瞬时失败。
- `BLOCKED`：需要新输入、权限或无法自动解决的条件。

取消采用协作式信号：控制面写 `cancelRequestedAt`，Worker 的 AbortController 终止 Provider/工具请求。工具副作用若已提交，必须通过事件披露，不能声称已经回滚。父任务取消沿创建关系向子任务级联。

实时全双工打断（在 token 级插入用户语音或按键）不是本 Runtime 的目标；聊天室追加消息按 Turn 边界队列处理。

## 9. 数据模型

在上游 Harness 模型基础上增加：

```prisma
model AgentRunTurn {
  id                  String   @id @default(cuid())
  runId               String
  turnIndex           Int
  inputDigest         String
  prefixDigest        String
  loadedSkillIds      Json
  loadedToolSchemaIds Json
  providerRequestId   String?
  assistantContent    Json
  thinking            Json?
  thinkingContinuity  String
  finishReason        String
  usage               Json
  startedAt           DateTime
  completedAt         DateTime

  @@unique([runId, turnIndex])
}

model AgentToolCall {
  id               String   @id
  runId            String
  turnIndex        Int
  toolId           String
  toolVersion      String
  arguments        Json
  argumentsDigest  String
  risk             String
  concurrency      String
  status           String
  idempotencyKey   String?
  result           Json?
  resultOrigin     String?
  resultArtifactId String?

  @@unique([runId, id])
  @@unique([idempotencyKey])
  @@index([runId, turnIndex])
}

model AgentApproval {
  id              String   @id @default(cuid())
  runId           String
  toolCallId      String
  argumentsDigest String
  status          String
  requestedAt     DateTime @default(now())
  decidedAt       DateTime?
  decidedBy       String?

  @@unique([runId, toolCallId, argumentsDigest])
}

model AgentVerification {
  id          String   @id @default(cuid())
  runId       String
  kind        String
  passed      Boolean
  evidence    Json
  createdAt   DateTime @default(now())
}
```

`AgentRunCheckpoint` 保存 `turnIndex`、`eventSequence`、`taskDigest`、`contextGeneration`、`skillBundleHash`、`mcpBundleDigest`、`loadedSkillIds`、`loadedToolSchemaIds`、`inboundSequence` 和累计预算。`AiRun` 增加 runtime、digest、checkpoint、取消、阻塞原因、Token、工具次数、费用、`proposedCompletedAt` 和 `verifiedAt` 字段。

## 10. 一致性、幂等与恢复

### 10.1 Turn 提交

```text
读取完整 Provider 响应
-> 事务写 AgentRunTurn + thinking + usage + run event
-> 创建 PENDING AgentToolCall
-> 更新 checkpoint（含已加载集合）
-> 提交事务
```

工具使用 `runId:toolCallId:argumentsDigest` 作为默认幂等键。内部写工具必须接受该键；MCP 写工具若不支持幂等，超时或断线后进入 `tool.outcome_unknown` 和 `BLOCKED`，禁止自动重放。

### 10.2 Worker 崩溃恢复

```text
租约到期 -> 新 Worker claim -> 验证所有 digest -> 加载 checkpoint
-> 检查 tool 调用与结果是否成对
   -> 缺配对：修复或 FAILED，不喂给模型
-> 查询未决 Tool Call
   -> 已有确定结果：继续
   -> 可幂等重试：沿用原 key 重试
   -> 非幂等且结果未知：BLOCKED
-> 按已加载集合重建 BUILD_INPUT，未加载项保持索引
```

### 10.3 Provider 错误

- `429`、明确 `5xx`、连接建立前失败：指数退避重试。
- 请求超时、idle watchdog 触发且 Provider 无查询能力：可重试只读推理，但记录 `continuity = REBUILT`。若写工具请求可能已发出，按 `outcome_unknown` 处理。
- 内容过滤、无效请求、上下文超限：不盲目重试。
- Adapter 解析失败：保存脱敏原始响应引用并最终失败。

### 10.4 并行只读故障

同 Turn 最多 4 个 `isolated` 只读工具。其中一个失败只写入该 `AgentToolCall` 的失败结果，其余继续。`forbidden` 或写工具不得与其它调用并行。存在显式依赖的并行批次才允许级联中止。

## 11. 安全架构

```text
不可信：用户消息、附件、Skill、模型输出、MCP 响应、记忆、检索结果、子任务 handoff
受控：TaskEnvelope、Policy Snapshot、Tool Registry、Sidecar、Output Verifier、Runtime Worker
高敏：Provider/MCP 凭据、管理员策略、业务数据库、评测门槛
```

Runtime Worker 不接收用户 Cookie，也不获得管理员数据库权限。凭据在调用时按 `secretRef` 解析，并从事件、日志、Turn 和 Artifact 中过滤。

首版工具采用进程内受控函数或独立 HTTP 服务，禁止动态代码执行。需要处理不可信文件的工具在独立容器中运行，使用只读根文件系统、临时目录、CPU/内存/PID 限额和出站网络 allowlist。

Prompt injection 不能只靠系统提示词解决：

- 数据内容与指令来源必须分层，见 `ContentPart.origin`
- 工具授权只依据 Policy Snapshot，不依据模型声称
- 附件、网页、MCP 返回值、记忆和检索结果不得改变允许工具、host、预算或审批规则
- Sidecar 不看自由文本，避免话术穿过审查
- 评测集必须包含注入夹在附件 / MCP 返回值 / Skill 正文中的金样，断言策略不变、写工具不执行

MCP 组合与未来 `CODE_RUNTIME` 都要过致命三要素：私有数据、不可信内容、对外通信。普通聊天 Runtime 不应三者齐备。网络出口默认拒绝。

若未来加入 Shell、文件和 Git：必须使用独立 `CODE_RUNTIME` capability、每 Run 容器和 workspace、非 root 用户、默认关闭网络，且禁止宿主目录和 Docker socket。不能直接给普通 Runtime Worker 增加宿主 Shell 权限。取消必须终止进程组，确认无残留进程。

## 12. 多 Agent

自建 Runtime 不在模型循环中启动隐式 subagent。Planner 产出 DAG 后，由控制面创建独立子 `AiRun`：

```text
Parent: WAITING_CHILDREN
├── Child A: research          (limits 由 Planner 分配)
├── Child B: data-analysis
└── Child C: image-generation
          |
          +-> Barrier -> Aggregator -> VERIFY_OUTPUT -> Parent PROPOSED_COMPLETE
```

每个子 Run 拥有独立 TaskEnvelope、租约、checkpoint、预算和工具账本。Aggregator 只接收结构化结果和 Artifact 引用，不拼接全部子任务日志。子任务输出的 `origin` 为 `child_handoff`。

聚合之后必须经过独立验证节点：先做确定性检查（契约、Artifact、真值），再视任务加 Reviewer。父任务取消和预算耗尽向子任务级联。

图上的节点可以是 Agent Loop、确定性程序或人工审批，不是只有模型节点。

## 13. 可观测性、审计与评估

运行指标和评测指标分开，不能互相替代。

**运行指标**：队列等待、Run/Turn 耗时、首 Token 延迟、Token/费用、工具耗时与错误、审批等待、Sidecar 延迟与超时、租约丢失、idle watchdog 触发、恢复次数、上下文压缩次数、前缀 cache 相关的 `prefixDigest` 变化次数。

**评测指标**（Eval Harness，评估对象是模型 + Harness 组合体）：任务成功率、越权写工具次数、重复副作用、注入攻击拦截率、完成核验通过率、模型替换分数差、压缩 / 状态栏 / Sidecar 消融差。

日志统一携带 `runId`、`parentRunId`、`roomId`、`runtimeId`、`turnIndex`、`toolCallId` 和 `leaseGeneration`，禁止记录密钥、Authorization header 和未经脱敏的隐私数据。

审计必须回答：谁触发、使用哪个 Agent/模型/Skill、读取哪些 Context 引用、请求什么工具、为何获准、Sidecar / 人工如何判定、产生哪些副作用、完成如何被核验、由哪个 Runtime 版本完成。

Phase 0 起维护 `runtime/eval/`：不少于 20 条房间任务，覆盖闲聊、只读查询、需审批写入、注入攻击、Worker 在 Turn 边界被杀。没有这组测试，不得把 MCP 和多 Agent 标为完成。

## 14. 部署方案

```text
smart-chat-web        Next.js Control Plane，水平扩展
smart-chat-worker     调度、核验和结果投影
agent-runtime-worker  Agent Loop，水平扩展
postgres              权威状态和事件
object-storage        Artifact 和大型结果
```

Runtime Worker 使用独立低权限数据库角色或受限 Control Plane API。生产环境需要优雅停机、readiness/liveness、实例并发上限和数据库扫描兜底。

第一版建议使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 加短轮询；只有任务规模或跨区域需求明确后再引入专用消息队列，避免初期维护两套一致性来源。

建议首发保护线：

```text
最大 Turn：12                      最大工具调用：32
同 Turn 并行只读工具：4            写工具：串行
模型请求超时：120 秒               流 idle watchdog：15–20 秒无 delta
工具超时：30 秒                    Sidecar 超时：500 ms，超时升级审批
总运行时间：15 分钟                租约：60 秒，每 20 秒续租
内联工具结果：64 KiB               Artifact：10 MiB
delta 刷盘：100-250 ms 或 4 KiB
压缩连续失败熔断：3 次
```

## 15. 实施路线

原阶段划分保持不变，只增加协议字段与验收，不插新的大阶段。Phase 6 标明为非目标。

### Phase 0：协议与行为锁定

- 为当前聊天、Supervisor、图片生成补齐回归测试。
- 定义版本化 Task、Event、Result、`ContentPart.origin` 和错误码。
- 将现有文本调用包装成无工具 `SELF_HOSTED` Adapter。
- 增加 `runtime/eval/` 骨架；静态前缀测试：改时间戳不得出现在 system 前缀。

验收：现有用户行为不变；结果可追溯到 task digest 和 runtime version；前缀稳定性测试通过。

### Phase 1：持久化 Agent Loop

- 建立 Turn、Event、Checkpoint 表，含 thinking、`prefixDigest`、已加载集合。
- 实现独立 Worker、claim、续租、取消、idle watchdog 和恢复。
- 实现代码维护的状态栏；Turn 边界注入排队中的用户消息。
- 工具调用 / 结果完整性检查。
- 协议冻结 `WorkspaceSpec` 与取消杀进程组字段。
- 支持 tool calling 协议，但暂不开放写工具。

验收：Worker 在任意 Turn 边界崩溃后可恢复，不产生重复消息；残缺轨迹不会进入下一轮模型输入。

### Phase 2：工具与审批

- 建立 Tool Registry、schema 校验、风险等级、`concurrency`、幂等账本。
- 实现 Sidecar（只看结构化调用）与 `WAITING_APPROVAL`。
- `VERIFY_OUTPUT` 与 `PROPOSED_COMPLETE`；写工具走服务端真值校验。
- 先接只读业务工具，再接带幂等键的写工具；受控 `notify_user`。

验收：未授权、参数变更、超预算和重复执行均被阻断并审计；提示注入不能让未授权写工具执行。

### Phase 3：Context、Skill 与 MCP

- 实现 Context Block、压缩、Artifact 外部化和 origin 分层。
- 固化 Skill Bundle hash；默认只注入目录。
- 实现 MCP Gateway、schema digest、secret reference、host allowlist、致命三要素评审。
- memory / retrieval 无指令效力。

验收：相同快照可确定性重建输入，且默认只注入目录 / 索引，已加载集合可复现；MCP schema 漂移时拒绝执行；Skill 未加载正文的变化不改变前缀 digest。

### Phase 4：多 Agent DAG

- 实现父子 Run、依赖、barrier、失败策略和 Aggregator。
- Planner 在父预算内分配子预算；handoff 写明工作顺序。
- Aggregator 之后的独立验证节点。
- 增加全局、房间、用户、Provider、Runtime、MCP 多维配额。

验收：父任务在 barrier 满足且验证通过后汇总；取消和预算向子任务传播。

### Phase 5：可选代码执行 Runtime

- 单独建设容器化文件、Shell 和 Git 工具。
- 实现 workspace 生命周期、网络策略和资源配额。
- 通过独立 capability 与审批策略开放。

验收：无法访问宿主文件系统、Docker socket 或未批准网络；取消后无残留进程。

### Phase 6：非目标 / 研究项

离线从审计事件生成候选 Skill，经独立验证和人工入库。不进入 Runtime Loop。业务 Agent 不得修改验证器、评测门槛、审计日志和稳定版本备份。

## 16. 验收标准

- Worker 重启不丢失已提交 Turn、工具结果和最终消息。
- `(runId, sequence)` 严格唯一，重复消费不产生重复副作用。
- 写工具拥有幂等键，或在结果未知时停止自动执行。
- 取消能终止模型/工具请求，并披露已经发生的副作用。
- Skill、MCP、策略和 Context 在单次 Run 中版本固定；默认按需注入，已加载集合可复现。
- 静态前缀跨 Turn 稳定；状态栏由代码维护；工具调用与结果成对。
- `COMPLETED` 仅在独立核验通过后由控制面投影。
- Provider/MCP 凭据不进入 TaskEnvelope、事件、Turn、日志或 Artifact。
- 多 Agent 子任务拥有独立预算、租约、checkpoint 和审计链。
- 注入攻击不能改变允许工具集，也不能让未授权写工具执行。
- Shell/文件系统能力只能在独立沙箱 Runtime 中启用。
- Runtime 不自动修改 Policy、Skill 或评测门槛。

## 17. 取舍与边界

- 选择数据库驱动状态机，是为了恢复、审计和审批语义清晰；delta 聚合与大型内容外部化用于控制写放大。
- 不追求请求级精确续传，因为多数 Provider 不支持流偏移恢复；系统保证 Turn 边界恢复并披露连续性。聊天室追加消息同样等到 Turn 边界，不做 token 级实时打断。
- 第一阶段不建设通用编码 Agent，因为 Shell、文件、Git 和沙箱的风险显著高于聊天及业务工具 Agent。通用工具优于专用工具，除非有安全、权限粒度、弱模型或尚无沙箱的明确理由，并写入 `specializationReason`。
- 不将队列作为事实来源，因为队列可能重复或漏投递；租约、checkpoint 和幂等记录必须落在 PostgreSQL。
- 不把「冻结版本」实现成「整包注入」。观察空间按需、相关、可控。
- 能靠 Harness 解决的问题不先做模型后训练。轨迹可离线回流为候选 Skill，但验证器不可被 Loop 修改。

最终职责边界：

```text
Smart Chat Harness（整体）
  控制面：为什么执行、由谁执行、允许看到什么、允许做什么；
          核验完成、投影消息、持有评测门槛。
  Runtime：如何按 ModelInputLayout 逐轮调用模型和工具，
           执行策略与 Sidecar，提交完成提议，并可靠暂停、恢复和结束。
Provider：生成候选文本或工具意图。
Tool/MCP：在策略批准后完成具体动作。
Sidecar / Verifier：独立于主模型自由文本的约束与验证钩子。
```

该边界让 Smart Chat 在聊天、图片和业务 Agent 场景中掌控完整执行协议，同时保留未来接入外部 CLI Runtime 或隔离代码 Runtime 的能力；所有 Runtime 继续共用同一 Task、Event、Result 和父子调度协议。
