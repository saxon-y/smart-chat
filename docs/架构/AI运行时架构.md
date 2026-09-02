# Smart Chat AI 运行时架构

日期：2026-09-01  
状态：对照自建 Runtime 方案、Harness 协议与现网执行路径修订  
配套：[产品功能](../产品/产品功能.md) · [技术架构](技术架构.md)  
依据：`docs/架构/自建智能体运行时设计.md`、`docs/架构/智能体工具框架设计.md`、`docs/架构/adr/ADR-001-智能体运行时边界.md`、`src/lib/harness/`、`src/lib/ai/`

Smart Chat 的 Harness 跨两个平面：控制面负责任务契约与治理；Runtime 负责单次 Run 内的 ReAct、策略执行、验证钩子和恢复。二者共用同一套 Task / Event / Result 协议。

这里的「自建」是自建运行时和治理协议，不是训练模型，也不是重写 Provider。模型能力仍通过 OpenAI-compatible、Gemini 或其他 API 获得。

---

## 1. 现网与目标

### 现网

`src/lib/ai/service.ts` 同时承担调度、上下文拼接、Provider 调用和结果落库。文本路径是单次 `chat/completions`；图片路径走 `OPENAI_IMAGES` / `GEMINI_IMAGES`。Worker 用租约 claim `AiRun`，成功后直接把 AI 消息投影进房间。

`AGENT_RUNTIME_MODE` 支持 `legacy` / `embedded` / `self_hosted`（`src/lib/ai/runtime-mode.ts`）。协议类型已在 `src/lib/harness/protocol/` 落地。

### 目标

```text
Control Plane → 冻结 TaskEnvelope → Runtime Queue
                                      │
                               Runtime Worker
                                      │
         Model Loop ↔ Policy ↔ Sidecar ↔ Tool / MCP
                │                              │
                └→ VERIFY_OUTPUT ──────────────┘
                                      │
                    Event / Checkpoint / Proposed Result
                                      │
              Control Plane 核验并投影 COMPLETED
```

完成权在控制面或独立验证器。Runtime 最多申报 `PROPOSED_COMPLETE`。模型不能批准自己完成。

---

## 2. 三平面总架构

![Self-hosted Agent Runtime — Three Planes](images/runtime-three-planes.jpeg)

### 2.1 控制面

Chat API、Supervisor、Context Planner、Skill Registry、Policy Snapshot、Scheduler、Approval API、Output Verifier、Result Projector、Eval Harness。

职责：创建 `AiRun`；固化 Agent、模型、Context、Skill、MCP、策略和预算；调度父子 Run；处理审批、取消和重试；核验完成提议；把 `RunResult` 投影成聊天室消息。评测门槛由控制面持有，Runtime 不得改写。

### 2.2 执行面

Dispatcher → Lease Guard → Agent Loop，再分支到 Provider Adapter、Policy Engine、Sidecar Gate、Tool Executor、MCP Gateway、Input Assembler、Event / Checkpoint Writer。

职责：原子 claim 与续租；从 checkpoint 恢复；按 `ModelInputLayout` 组装输入；调用模型；规范化 tool calls；执行策略、Sidecar 与工具；顺序写事件和完成提议。

Runtime **不直接写聊天室业务表**。只读真值查询走受控内部 API 或只读数据库角色。

### 2.3 数据面

| 存储 | 角色 |
| --- | --- |
| PostgreSQL | runs、turns、events、calls、checkpoints、approvals。事实来源 |
| Object Storage | 附件、超大工具响应、Artifact |
| Queue / NOTIFY | 只唤醒，不是权威状态 |

实线 = 权威路径。虚线 = 唤醒信号。

---

## 3. 统一任务契约

控制面发送版本化任务包，而不是一段 Prompt。协议字面量：`smart-chat-harness/v1`。

```ts
type TaskEnvelope = {
  protocolVersion: "smart-chat-harness/v1";
  runId: string;
  parentRunId?: string;
  roomId: string;
  triggerMessageId: string;
  objective: string;
  agent: AgentSnapshot;
  runtime: { id: string; kind: "EMBEDDED" | "SELF_HOSTED" | "DAEMON"; adapter: string; adapterVersion: string; requiredCapabilities: string[] };
  contextBundle: ContextBundle;
  skillBundle: SkillBundle;
  mcpBundle: McpBundle;
  policy: ExecutionPolicy;
  limits: ExecutionLimits;
  outputContract: { format: "TEXT" | "JSON" | "ARTIFACT_SET"; schema?: object };
};
```

实现：`src/lib/harness/protocol/task-envelope.ts`。Zod 会拒绝名为 `apiKey` / `cookie` / `secret` / `token` / `ciphertext` 等字段，防止凭据进入任务包。

Runtime 抽象：

```ts
interface AgentRuntime {
  capabilities(): Promise<RuntimeCapabilities>;
  execute(task: TaskEnvelope): Promise<RuntimeSession>;
  resume(task: TaskEnvelope): Promise<RuntimeSession>;
  cancel(runId: string): Promise<void>;
}
```

实现：`src/lib/harness/runtime/types.ts`。聊天室业务不感知 Claude / Codex / Gemini 私有协议。

任务包在首次 claim 前计算 digest 并冻结。后台改 Agent Prompt、Skill 或 MCP，不得静默改变正在运行或恢复中的任务。

---

## 4. Agent Loop：只提议，不自完成

![Agent Loop Engine — Propose, Never Self-Complete](images/runtime-agent-loop.jpeg)

```text
LOAD_TASK → DRAIN_INBOUND → BUILD_INPUT → MODEL_REQUEST → MODEL_RESPONSE
                                                              │
                         有 tools ──→ AUTHORIZE_TOOLS
                                       ├ DENY
                                       ├ WAITING_APPROVAL
                                       ├ SIDECAR
                                       └ EXECUTE_TOOLS → APPEND_RESULTS
                                                       → CHECK_LIMITS
                                                       → CHECKPOINT
                                                       → 回到 DRAIN_INBOUND
                         无 tools / 模型声称完成
                                       └ VERIFY_OUTPUT
                                           ├ PROPOSE_COMPLETE → 控制面投影 COMPLETED
                                           ├ CONTINUE
                                           └ BLOCKED
```

硬约束：

- Runtime **不得**把房间可见状态写成 `COMPLETED`。
- 入站事件只在 Turn 边界 `DRAIN_INBOUND`：新用户消息排队；取消用 AbortController；暂停 / 审批释放租约但保留 checkpoint。
- 不承诺从中断的模型 HTTP 流中续传。
- 第一阶段不做「边跑边聊」。

流式连接除请求超时外，必须有独立 idle watchdog：连续 15–20 秒没有 `text.delta` / `thinking.summary` / `tool.arguments.delta` 即判定静默卡死。租约续租不得让卡死 Worker 一直占着 Run。

---

## 5. AiRun 状态机与租约

![AiRun State Machine](images/runtime-state-machine.jpeg)

```text
PENDING → PREPARING → READY → CLAIMED → RUNNING
                                          ├ WAITING_APPROVAL → READY
                                          ├ PAUSED → READY
                                          ├ RETRY_WAIT → READY
                                          ├ WAITING_CHILDREN → READY
                                          ├ VERIFYING → PROPOSED_COMPLETE → SUCCEEDED
                                          ├ BLOCKED
                                          ├ FAILED_FINAL
                                          └ CANCELLED
```

| 状态 | 含义 |
| --- | --- |
| `PREPARING` | 控制面正在冻结快照，还不能执行 |
| `READY` | `TaskEnvelope` 完整 |
| `RUNNING` | 只有租约持有者可写 Turns 和 Tool Calls（`runId + owner + leaseGeneration`） |
| `WAITING_APPROVAL` | 释放算力与租约，保留 checkpoint |
| `PROPOSED_COMPLETE` | Runtime 交付提议，不是房间成功 |

现网 Prisma `AiRunStatus` 已包含 `PENDING` `PREPARING` `READY` `CLAIMED` `RUNNING` `WAITING_APPROVAL` `PAUSED` `RETRY_WAIT` `BLOCKED` `SUCCEEDED` `NO_ACTION` `CANCELLED` `FAILED_RETRYABLE` `FAILED_FINAL`。目标协议中的 `PROPOSED_COMPLETE` / `VERIFYING` 是控制面投影前的执行态，尚未全部写入当前 enum。

租约建议：租约 60s，每 20s 续租；idle watchdog 15–20s。暂停和恢复发生在 Turn 边界。

Dispatcher 只选择 `READY` 或到期 `RETRY_WAIT`、capability 满足且未超配额的 Run。claim 用事务 CAS 更新 `leaseGeneration`。租约丢失的 Worker 不得提交结果。

---

## 6. BUILD_INPUT：静态前缀 / 轨迹 / 状态栏

![BUILD_INPUT — ModelInputLayout](images/runtime-input-layout.jpeg)

```text
[静态前缀，跨 Turn 字节级稳定]
  系统策略 + Agent Persona + 冻结工具名索引 + 输出契约
  禁止：timestamps / budget remaining
[轨迹，只追加]
  已提交 Turn、成对 Tool Call + Tool Result
  大结果只保留摘要 + artifactRef
[按需追加，不回写前缀]
  本 Turn 加载的 Skill 正文、完整工具 schema
[状态栏，每 Turn 由代码重写在末尾]
  now, turnIndex, budget remaining, tool counts, approval, children
  从 checkpoint 计算，禁止再用一次 LLM 去总结
```

| 冻结（审计 / 恢复） | 注入（模型可见） |
| --- | --- |
| Skill 目录 hash、MCP `schemaDigest`、Policy Snapshot | name + description 目录、工具名索引 |

前缀稳定是为了 KV-cache 复用。禁止滑动窗口压缩；不得丢弃成对工具结果；不得静默丢弃安全策略。连续压缩失败 3 次熔断为 `BLOCKED`。

`toolDisclosure: "full"` 是弱模型的显式例外，必须写在 Policy Snapshot 里，不能由模型在运行中请求。

ContentPart 带来源：

```text
system_policy | user | skill | tool | mcp | memory | retrieval | child_handoff
```

只有 `system_policy` 和经 Context Planner 标记的用户目标具有指令效力。其余默认是不可信证据。

---

## 7. 工具授权链

![Tool Authorization Path](images/runtime-tool-auth.jpeg)

模型只发出 `tool_calls`，这是意图，不是许可。Sidecar 只看结构化调用，不看思考文本。凭据永不进入 `TaskEnvelope`。

授权顺序：

1. 工具版本 + JSON Schema
2. Agent capability + 房间权限
3. 服务端真值（金额、资源 ID、成员）。模型参数只作提示
4. 审批绑定 + 预算
5. 幂等账本 `runId:toolCallId:argumentsDigest`
6. 风险分叉
    - `READ` → 执行
    - `WRITE` → Sidecar Gate（结构化 `{toolId, version, arguments, risk, schemaDigest}`，500ms，超时升级审批，**从不 fail-open**）
    - `DESTRUCTIVE` 或不确定 → `WAITING_APPROVAL`

`NON_IDEMPOTENT` 且结果未知 → `BLOCKED`，禁止自动重放。

MCP Gateway 校验管理员批准的 `schemaDigest`，按 `secretRef` 即时解析凭据。MCP 是工具来源，不是权限来源。出站网络默认拒绝 + host allowlist。

接入一组 MCP 时必须做致命三要素评审：私有数据访问、不可信内容暴露、对外通信。三者齐备则必须拆权限、关出口、或强制审批，不能只靠提示词。

`spawn_subagent` 不是 Runtime 内工具，只允许走控制面 API。

---

## 8. Checkpoint 与崩溃恢复

![Turn Commit, Checkpoint, Crash Recovery](images/runtime-checkpoint.jpeg)

合法 checkpoint 时刻：

- 完整模型响应落库后
- 一组工具结果落库后
- 进入 `WAITING_APPROVAL` 前
- 进入 `PROPOSED_COMPLETE` 前

流式 delta **不是**恢复边界。连接中断时丢弃不完整响应。

崩溃恢复：

```text
lease expires
  → 新 worker claim
  → 校验 digest
  → load checkpoint
  → 检查 tool / result 配对（残缺则修复或 FAIL，禁止喂给模型）
  → pending tool calls:
        已知结果 → 继续
        带幂等键 → 用同一把钥匙重试
        NON_IDEMPOTENT 且未知 → BLOCKED
  → 用快照 + 已加载集合重建 BUILD_INPUT
```

连续性披露：`FULL` | `REBUILT` | `GAP`。队列不是事实来源。

checkpoint 必须保存 `loadedSkillIds` / `loadedToolSchemaIds`、`inboundSequence`、累计预算与工具计数。

---

## 9. 多 Agent DAG

![Multi-Agent DAG — Process Isolation](images/runtime-multi-agent-dag.jpeg)

多 Agent 并行由控制面创建父子 `AiRun` 和 DAG，不隐藏在单个 Runtime Loop 里。禁止 implicit subagent。

```text
Planner 发出 DAG
  → Parent AiRun 进入 WAITING_CHILDREN
  → Child A research / Child B data-analysis / Child C image-generation
     各有独立 TaskEnvelope、lease、checkpoint、budget、tool ledger
  → barrier
  → Aggregator 只收结构化结果 + Artifact refs，origin = child_handoff
  → VERIFY_OUTPUT（先确定性，再可选 Reviewer Run）
  → Parent PROPOSED_COMPLETE
```

Planner 在父任务上限内给每个子 Run 分配预算，不得让所有孩子套同一个 `maxTurns: 12`。handoff 写明 plan / execute / self-check。取消和预算耗尽从父级级联到子级。

共享协议，隔离上下文。完成仍在执行者之外核验。

---

## 10. 信任分层与部署

![Trust Boundaries and Deployment](images/runtime-trust-deployment.jpeg)

### 10.1 信任区

| 区 | 内容 |
| --- | --- |
| 不可信 | 用户消息、附件、Skill 正文、模型输出、MCP 响应、memory、retrieval、child_handoff |
| 受控 | `TaskEnvelope`、Policy Snapshot、Tool Registry、Sidecar、Output Verifier、Runtime Worker |
| 高敏 | Provider / MCP 凭据、admin policy、业务 DB、eval gates |

出站默认拒绝。Eval gates 不能被 Loop 改写。

### 10.2 进程拆分

| 进程 | 职责 | 权限 |
| --- | --- | --- |
| `smart-chat-web` | Next.js 控制面，水平扩展 | 用户 Cookie、业务写 |
| `smart-chat-worker` | 调度、核验、投影结果 | 业务写，无长 Agent Loop |
| `agent-runtime-worker` | Agent Loop | 低权限 DB 角色，无用户 Cookie，无 admin DB |
| `postgres` | 权威状态 | — |
| object storage | Artifact | 私有卷或未来 S3 |
| `CODE_RUNTIME` | Phase 5 沙箱 | per-run 容器、非 root、断网、无宿主 FS、无 Docker socket |

普通 Runtime Worker 不得获得宿主 Shell。第一阶段只提供受控工具和 MCP，不提供任意 Shell、Git 或宿主文件系统。`WorkspaceSpec` 与取消杀进程组语义在 Phase 1 即冻结。

---

## 11. 两类 Runtime，同一套房间协议

![两类 Runtime](images/solution-dual-runtime.jpeg)

| Runtime | 类型 | 用途 |
| --- | --- | --- |
| OpenAI Compatible | Embedded | 文本 Agent、Supervisor、短 MCP |
| Gemini / OpenAI Images | Embedded | 图片生成 |
| 自建 Agent Loop | Self-hosted Worker | 多轮工具、审批、可恢复长任务 |
| Codex App Server | Daemon（规划） | 编码和工作区 |
| Claude Code Stream JSON | Daemon（规划） | 编码、工具和 MCP |

两者都消费 `TaskEnvelope`，都发出 `RunEvent` / `RunResult`。Daemon 不直连业务数据库，只用控制面签发的短期任务凭证访问 API。取消外部 Agent 时终止完整进程组，避免工具或 MCP 子进程泄漏。

---

## 12. 核心决策（必须遵守）

1. Runtime 作为独立 Node.js Worker 部署，不运行在 Next.js API 请求生命周期内。
2. 每个 `AiRun` 是独立状态机；每次完整模型响应或工具结果构成一个持久化 Turn。
3. PostgreSQL 是执行状态的事实来源，队列只负责唤醒和削峰。
4. Runtime 只消费冻结后的 `TaskEnvelope`，不自行扩大上下文、权限或工具集合。
5. 模型只提出工具调用；Policy Engine 决定拒绝、执行或等待审批。
6. 外部副作用必须带稳定幂等键；结果未知时不得自动重放非幂等写操作。
7. 暂停和恢复发生在 Turn 边界。
8. 多 Agent 并行由控制面 DAG 表达。
9. 完成权在控制面。Runtime 不得写房间可见的成功。
10. BUILD_INPUT 遵守静态前缀 / 只追加轨迹 / 代码维护的状态栏。
11. Skill 与 MCP schema 冻结版本，但按需注入。

---

## 13. 相关文档

- 产品怎么用：[产品功能](../产品/产品功能.md)
- 系统怎么部署：[技术架构](技术架构.md)
- 设计原文：[Harness](智能体工具框架设计.md) · [自建 Runtime](自建智能体运行时设计.md)
- 决策：[ADR-001](adr/ADR-001-智能体运行时边界.md)
- 落地任务：[AGENT_HARNESS_RUNTIME_TASKS](../运行时/智能体运行时任务.md)
