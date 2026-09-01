# Smart Chat Agent Harness 与自建 Runtime 实施任务书

日期：2026-09-01
状态：待实施
依据：`docs/AGENT_HARNESS_DESIGN.md`、`docs/SELF_HOSTED_AGENT_RUNTIME_DESIGN.md`

## 1. 文稿目的

本文将两份架构设计转换为可执行的工程任务。任务以可独立验收、可回滚、可追踪为原则，覆盖 Harness 控制面、自建 Runtime 执行面、数据模型、安全、工具、MCP、多 Agent、可观测性和部署。

本文不是对所有任务同时开工的授权。各阶段必须满足入口条件和验收门禁后才能进入下游阶段。

### 任务状态规则

- `[ ]`：未完成，包括未开始、进行中或尚未通过全部验收条件。
- `[x]`：已完成，代码、测试、文档和该任务验收证据均已齐备。
- 任务开始后可在标题下增加 `进度：进行中`，但在全部验收条件通过前不得勾选。
- 每次完成任务时，执行者应自行将对应标题从 `[ ]` 更新为 `[x]`，并记录验证结果。

## 2. 当前基线

当前仓库已经具备以下基础：

- `prisma/schema.prisma:248` 的 `AiRun` 已包含父子关系、租约 generation、重试、取消和幂等键。
- `src/lib/ai/service.ts:91` 已实现数据库 claim 与房间/Agent 并发控制。
- `src/lib/ai/service.ts:206` 是当前统一执行入口，但仍直接执行单轮 Provider 调用。
- `src/lib/ai/providers.ts:43` 已封装 OpenAI-compatible 文本调用，图片 Provider 也在同一模块。
- `src/lib/ai/context.ts:6` 目前只将最近消息线性转换为 Provider messages。
- `scripts/agent-worker.ts:1` 通过内部 HTTP 轮询触发 `recoverPendingAiRuns`，长任务仍依赖 Web API 生命周期。
- `src/app/api/rooms/[roomId]/runs/[runId]/cancel/route.ts` 与 `retry/route.ts` 已提供基础控制 API。
- `Artifact` 和 `OutboxEvent` 已存在，可作为大型结果和稳定通知的迁移基础。

当前缺口：版本化协议、不可变任务快照、运行事件序列、Turn、checkpoint、Runtime 注册、自建 Agent Loop、工具调用账本、审批、Skill revision、MCP revision、Context 预算、多 Agent DAG 和独立 Runtime Worker。

## 3. 范围与非目标

### 3.1 本任务书范围

- 建立统一 Harness 协议与 Runtime Adapter。
- 将现有聊天、Supervisor 和图片执行迁移到统一协议。
- 建设独立自建 Runtime Worker 与持久化 Agent Loop。
- 实现 Context、Skill、工具策略、审批和 MCP Gateway。
- 实现父子 Run、DAG、barrier 和结构化汇总。
- 提供恢复、取消、审计、指标和部署能力。
- 为后续 Codex/Claude CLI Daemon 保留兼容协议。

### 3.2 首版非目标

- 不实现任意宿主 Shell、Git 或文件系统访问。
- 不实现完整编码 IDE。
- 不允许模型修改策略、预算、工具 allowlist 或审批结果。
- 不实现跨任意模型 HTTP 流偏移的精确续传。
- 不把队列作为任务状态唯一来源。

## 4. 交付原则

1. **协议先行**：先冻结协议与错误语义，再迁移执行逻辑。
2. **行为锁定**：改造前补回归测试，现有聊天功能不能因架构迁移退化。
3. **数据库为事实来源**：队列、WebSocket 和通知允许重复或丢失。
4. **Turn 边界恢复**：只承诺从已提交 Turn 和 Tool Result 恢复。
5. **副作用幂等**：无法确认结果的非幂等写调用必须阻塞人工处理。
6. **权限在 Harness**：Provider、模型和 MCP 都不是权限来源。
7. **小步迁移**：旧执行路径在新路径完成对等验证前保留 feature flag 回退能力。

## 5. 里程碑与依赖

| 里程碑 | 内容 | 前置 | 完成门禁 |
| --- | --- | --- | --- |
| M0 | 回归基线与 ADR | 无 | 当前行为测试通过 |
| M1 | 协议、数据模型、事件 | M0 | schema、协议契约测试通过 |
| M2 | Embedded Adapter 迁移 | M1 | 文本/图片/Supervisor 行为对等 |
| M3 | 独立 Runtime Worker 与 Agent Loop | M2 | 崩溃恢复、租约隔离通过 |
| M4 | Context 与 Skill | M3 | digest 固定、预算与压缩通过 |
| M5 | Tool Policy 与审批 | M3、M4 | 未授权/重复副作用被阻断 |
| M6 | MCP Gateway | M5 | schema 漂移、secret 隔离通过 |
| M7 | 多 Agent DAG | M3、M4 | barrier、取消传播、预算通过 |
| M8 | 生产化与 Daemon 扩展 | M5-M7 | 压测、安全、故障演练通过 |

## 6. Epic A：基线、决策与 Feature Flag

### [x] TASK-A01：锁定现有执行行为

完成证据（2026-09-01）：新增 `service.test.ts`、`ai-trigger.test.ts` 和 Provider 文本回归测试；`npm test` 50/50 通过，typecheck、Prisma validate 和 production build 通过，lint 0 error。

**目标**：在拆分 `src/lib/ai/service.ts` 前建立可重复的回归基线。

**改动范围**：

- 新增 `src/lib/ai/service.test.ts`。
- 扩展 `src/lib/ai/providers.test.ts`、`context.test.ts`、`routing.test.ts`。
- 覆盖 `src/lib/chat/ai-trigger.ts` 的触发语义。

**任务**：

- 测试 DIRECT、SUPERVISOR、DELEGATED 三种模式。
- 测试文本、图片、NO_ACTION、Provider 可重试/最终失败。
- 测试成员版本变化、租约丢失、重复 trigger、取消与人工重试。
- 固定消息、Artifact、Outbox 的事务提交语义。

**验收**：

- 重复执行相同 `runId` 不产生第二条响应消息或重复 Artifact。
- 租约 generation 不匹配的 Worker 无法提交完成状态。
- Provider 429/5xx 最多按既有规则进入 retryable；权限撤销进入取消。
- `npm test`、`npm run typecheck`、`npm run lint` 通过。

### [x] TASK-A02：记录架构决策

完成证据（2026-09-01）：新增 `docs/adr/ADR-001-agent-runtime-boundary.md`，已记录 Decision、Drivers、Alternatives、Consequences、Constraints 和 Follow-ups。

**交付物**：新增 `docs/adr/ADR-001-agent-runtime-boundary.md`。

ADR 必须确认：PostgreSQL 为事实来源、独立 Worker、Turn 边界恢复、普通 Runtime 不提供 Shell、队列仅唤醒、外部 CLI 与自建 Runtime 共用协议。

**验收**：ADR 的 Decision、Drivers、Alternatives、Consequences、Follow-ups 完整，且与两份设计文档无冲突。

### [x] TASK-A03：增加迁移开关

完成证据（2026-09-01）：实现严格 `AGENT_RUNTIME_MODE` 解析，将 runtime id/kind/version 固定到新建父子 Run；legacy Worker 只 claim legacy 或历史空值 Run，防止跨 Runtime 双执行。

**改动范围**：`.env.example`、`src/lib/ai/service.ts` 或新的 orchestration 配置模块。

**任务**：

- 增加 `AGENT_RUNTIME_MODE=legacy|embedded|self_hosted`。
- 新路径失败时只允许显式配置回退，不允许同一 Run 静默双执行。
- 记录实际选择的 runtime kind 和版本。

**验收**：三个模式配置非法时启动或执行立即失败；同一 Run 不会同时进入 legacy 与新 Runtime。

## 7. Epic B：统一协议与错误模型

### [x] TASK-B01：定义版本化协议包

完成证据（2026-09-01）：新增 `src/lib/harness/protocol/`，包含严格 Zod schema、canonical JSON、SHA-256 digest、嵌套 secret 拒绝和 9 项协议/registry 契约测试。

**改动范围**：新增 `src/lib/harness/protocol/`。

建议文件：

```text
protocol/
├── task-envelope.ts
├── context.ts
├── skill.ts
├── mcp.ts
├── policy.ts
├── events.ts
├── result.ts
├── errors.ts
└── index.ts
```

**任务**：

- 使用 TypeScript 类型和 Zod runtime schema 定义 `TaskEnvelope v1`。
- 定义 `RunEvent`、`RunResult`、`ToolCall`、`ToolResult`、`RuntimeCapabilities`。
- 定义 canonical JSON 与 SHA-256 digest 规则。
- 禁止 unknown 字段在安全相关结构中静默通过。

**验收**：

- 相同逻辑对象跨 key 顺序得到相同 digest。
- 缺少协议版本、策略、预算或快照 digest 时校验失败。
- secret、Cookie 字段通过显式负面 fixture 被拒绝。
- 协议 fixture 可以 serialize -> parse -> serialize 保持语义一致。

### [x] TASK-B02：建立统一错误分类

完成证据（2026-09-01）：实现 category、retryable、outcomeKnown、continuity 和安全 public message；自动重试采用显式 allowlist，未知副作用失败关闭。

**任务**：定义错误属性 `code`、`category`、`retryable`、`outcomeKnown`、`continuity` 和安全的用户消息。

至少覆盖：Provider 429/5xx/timeout、内容过滤、上下文超限、schema 漂移、权限拒绝、审批等待、租约丢失、非幂等结果未知和 Runtime 不兼容。

**验收**：未知 Error 不向用户暴露堆栈；只有 allowlist 中的错误可以自动重试；`outcomeKnown=false` 的写操作不会自动重放。

### [x] TASK-B03：定义 Runtime 接口

完成证据（2026-09-01）：实现统一 `AgentRuntime`、`RuntimeSession`、capabilities 与 `RuntimeRegistry`；缺失 Runtime、重复注册和 capability mismatch 均有测试。

**改动范围**：新增 `src/lib/harness/runtime/types.ts` 与 registry。

**验收**：Embedded、自建 Worker、未来 CLI Daemon 均能通过同一个 `AgentRuntime` 契约注册；capability 不满足时在执行前返回确定错误。

## 8. Epic C：数据模型与迁移

### [x] TASK-C01：扩展运行状态与 AiRun

完成证据（2026-09-01）：新增 PREPARING、READY、WAITING_APPROVAL、PAUSED、RETRY_WAIT、BLOCKED 状态和 Runtime/digest/checkpoint/usage 字段；提供 Prisma migration 与幂等 manual upgrade，并已成功应用本地现有数据库。

**改动范围**：`prisma/schema.prisma`、Prisma migration、manual upgrade SQL。

**任务**：

- 增加 `PREPARING`、`READY`、`WAITING_APPROVAL`、`PAUSED`、`RETRY_WAIT`、`BLOCKED`。
- 为 `AiRun` 增加 runtime、task digest、context generation、bundle digest、checkpoint、取消、阻塞原因、累计 usage/cost 字段。
- 为状态扫描和 runtime claim 添加复合索引。

**验收**：现存 status 数据可无损迁移；旧 Run 仍可查询；migration 在空库和现有数据 fixture 上均成功。

### [ ] TASK-C02：新增 Runtime、Event、Turn 与 Checkpoint 表

**交付物**：`AgentRuntime`、`AgentRunEvent`、`AgentRunTurn`、`AgentRunCheckpoint`。

**约束**：

- `(runId, sequence)` 唯一。
- `(runId, turnIndex)` 唯一。
- checkpoint 只引用已提交 Turn/Event。
- Runtime heartbeat 和 capability/version 可查询。

**验收**：并发写事件不会产生重复 sequence；删除/归档策略不破坏审计链；关键查询有索引计划证据。

### [ ] TASK-C03：新增 Tool、Approval、Skill 与 MCP revision 表

**交付物**：`AgentToolCall`、`AgentApproval`、`SkillRevision`、`McpConfigRevision`。

**验收**：审批唯一键包含 `runId + toolCallId + argumentsDigest`；Skill bundle hash 和 MCP revision 不可变；幂等键唯一冲突返回已有执行结果而非再次执行。

### [ ] TASK-C04：建立数据保留策略

**任务**：定义 delta、Turn、checkpoint、工具结果和 Artifact 的保留/压缩规则；新增清理脚本和 dry-run。

**验收**：清理不会删除活跃 Run 的恢复材料；审计摘要保留；dry-run 输出精确目标而不修改数据。

## 9. Epic D：控制面编排重构

### [ ] TASK-D01：构建 TaskEnvelope

**改动范围**：新增 `src/lib/harness/orchestration/task-builder.ts`。

**任务**：

- 从 `AiRun`、Agent、Model、Room、Context、Skill、MCP 和 Policy 生成快照。
- 在 `PREPARING -> READY` 前原子保存 task digest。
- 失败时进入确定的 `BLOCKED` 或 `FAILED_FINAL`，不得留下半成品 READY Run。

**验收**：后台修改 Agent/Skill/MCP 后，已 READY Run 的 envelope 与 digest 不变；任务包无明文凭据。

### [ ] TASK-D02：拆分 `service.ts`

**目标结构**：

```text
src/lib/harness/orchestration/
├── claim.ts
├── prepare.ts
├── dispatch.ts
├── completion.ts
├── cancellation.ts
└── recovery.ts
```

**任务**：将 `src/lib/ai/service.ts:91-289` 的 claim、执行、完成、错误、恢复、取消与重试分离；原导出保留兼容 facade，直至调用方迁移完毕。

**验收**：现有 API 和 `ai-trigger.ts` 行为不变；模块间无循环依赖；每个事务边界有单元或集成测试。

### [ ] TASK-D03：结果投影与事件分层

**任务**：`AgentRunEvent` 保存细粒度执行事实，`OutboxEvent` 只发布稳定业务事件；最终消息由 Result Projector 幂等创建。

**验收**：重复 `run.completed` 不产生重复 Message；高频 delta 不进入 Outbox；SSE 断线重连不会重复显示最终消息。

## 10. Epic E：Embedded Runtime 对等迁移

### [ ] TASK-E01：OpenAI-compatible Adapter

**改动范围**：重构 `src/lib/ai/providers.ts`，新增 `src/lib/harness/runtime/embedded/`。

**任务**：支持流式/非流式文本事件、Provider request ID、usage、AbortSignal 和统一错误；先保持无工具单轮行为。

**验收**：与现有 `callChatProvider` 输出对等；超时真正取消 fetch；流式 delta 聚合后文本与最终结果一致。

### [ ] TASK-E02：图片 Adapter

**任务**：将 OpenAI/Gemini 图片生成包装为统一 Runtime Result 和 Artifact event，保留格式、大小、URL 安全和 moderation 检查。

**验收**：PNG/JPEG 验证、20 MiB 上限、对象存储回滚、Gemini aspect 映射均通过既有及新增测试。

### [ ] TASK-E03：Supervisor Adapter

**任务**：Supervisor 同样通过 TaskEnvelope 和 Runtime 执行；结构化验证 routing decision；子 Run 只入队，不在父执行栈内递归调用 `processAiRun`。

**验收**：父 Supervisor 完成后子 Run 独立 claim；无候选和低置信度产生 NO_ACTION；重复路由不创建第二个子 Run。

### [ ] TASK-E04：灰度与对等验证

**任务**：按 Agent 或房间启用 embedded path，记录 legacy/new 输出状态、Token 和延迟，但禁止双路径产生副作用。

**验收**：测试环境连续执行文本、图片、Supervisor 场景无已知行为回归；feature flag 可独立回退新创建的 Run。

## 11. Epic F：Context Planner 与 Skill Bundle

### [ ] TASK-F01：Context Block 与来源分级

**改动范围**：新增 `src/lib/harness/context/`，替代 `src/lib/ai/context.ts` 的线性拼接。

**任务**：实现 `origin`、priority、pinned、token estimate、sourceRef；只有系统策略与明确用户目标具有指令效力。

**验收**：无关房间消息不会进入 bundle；policy、task、激活 Skill 永不被静默裁剪；tool call/result 成对保留。

### [ ] TASK-F02：预算、压缩与 Artifact 外部化

**任务**：实现确定性裁剪顺序、结构化摘要、大结果外部化和三次压缩失败阻断。

**验收**：超过预算返回 `CONTEXT_BUDGET_EXCEEDED`；安全策略仍存在；相同输入生成相同 block 顺序和 digest；压缩循环有硬上限。

### [ ] TASK-F03：Skill Loader 与 Bundle hash

**改动范围**：新增 `src/lib/harness/skills/`，复用现有 `Skill` 管理 API。

**任务**：解析 `SKILL.md`、manifest 和依赖文件；防止路径穿越和 symlink 越界；验证 requiredTools/capabilities；创建 immutable revision 和 bundle hash。

**验收**：任一文件变化导致 bundle hash 变化；运行中 Skill 修改不影响原 Run；越界引用和缺少工具依赖被拒绝。

### [ ] TASK-F04：Runtime 原生上下文映射

**任务**：为未来 Daemon 生成 `.run/` 文件和 Codex/Claude/Qwen 入口，使用受管理 marker 幂等更新并保留用户内容。

**验收**：重复准备 workspace 不重复插入 Harness 内容；用户原文件字节内容在 marker 外保持不变。

## 12. Epic G：自建 Runtime Worker 与持久化 Loop

### [ ] TASK-G01：独立 Worker 进程

**改动范围**：新增 `runtime/` package 或 workspace、更新 `package.json`、`compose.yaml`、`.env.example`。

**任务**：实现数据库扫描/通知、`SKIP LOCKED` claim、续租、readiness、liveness、优雅停机和并发上限。

**验收**：停止 claim 后能在 checkpoint 边界退出；两个 Worker 不执行同一个 lease generation；漏失通知后扫描仍会拾取 Run。

### [ ] TASK-G02：Agent Loop 状态机

**任务**：实现 LOAD、BUILD_INPUT、MODEL、AUTHORIZE、TOOLS、APPEND、CHECK_LIMITS、CHECKPOINT、FINALIZE 状态。

**验收**：无工具、多轮工具、模型长度终止、预算耗尽、取消和不可重试失败均有确定终态；循环无法无限运行。

### [ ] TASK-G03：Turn 与 delta 持久化

**任务**：完整响应才提交 Turn；delta 按 100-250 ms 或 4 KiB 聚合；input digest 可重建。

**验收**：中断的半个响应不会成为 Turn；高频流式输出不会逐 Token 写数据库；最终文本与聚合 delta 一致。

### [ ] TASK-G04：Checkpoint 与崩溃恢复

**任务**：从最新 checkpoint 恢复 Turn、Event、Tool 状态和累计预算；验证 task/skill/MCP digest。

**验收**：在模型完成后、工具完成后、checkpoint 前后注入崩溃，恢复均不重复最终消息或已知副作用；digest 不匹配时拒绝恢复并披露 continuity gap。

### [ ] TASK-G05：协作式取消与 watchdog

**任务**：`cancelRequestedAt` 驱动 AbortController；加入模型、工具、无活动和总运行时间 watchdog。

**验收**：取消进行中的 fetch 后 Run 进入 CANCELLED；已提交副作用保留审计；租约丢失后 Worker 停止写入。

## 13. Epic H：Tool Registry、Policy 与审批

### [ ] TASK-H01：Tool Registry

**任务**：注册稳定 tool ID/version/schema digest、风险、幂等等级、timeout 和结果上限；禁止动态模块名加载。

**验收**：schema 不合法、版本不匹配、未注册或超大小结果均被统一拒绝；工具 schema 只按 policy disclosure 规则进入模型上下文。

### [ ] TASK-H02：Policy Engine

**任务**：依序验证 Skill 依赖、Agent capability、成员权限、参数边界、schema digest、risk、host 和预算。

**验收**：模型文本无法覆盖 deniedTools 或 allowedHosts；权限在 tool call 与执行之间撤销时执行被拒绝；判定理由写入审计事件。

### [ ] TASK-H03：工具幂等账本

**任务**：使用 `runId:toolCallId:argumentsDigest`；READ 可安全重试，KEYED 必须传递 key，NON_IDEMPOTENT 结果未知时阻塞。

**验收**：相同 key 并发执行只有一次副作用；参数变化生成新 digest；outcome unknown 不自动重放。

### [ ] TASK-H04：审批 API 与 UI

**改动范围**：新增房间 Run approval API，扩展运行详情 UI/管理台。

**任务**：创建、批准、拒绝审批；验证审批者房间/管理权限；审批绑定 arguments digest；恢复 Run 到 READY。

**验收**：无权限用户返回 403；审批后参数变化必须重新审批；重复批准幂等；拒绝产生结构化 ToolResult 并由 Loop 继续或终止。

### [ ] TASK-H05：首批受控工具

**范围**：先接只读房间信息、Artifact 读取等内部工具，不接任意 SQL、Shell 或文件系统。

**验收**：工具只能读取当前 room/policy 允许资源；响应超限转 Artifact；每次调用可由 run/toolCallId 追踪。

## 14. Epic I：MCP Registry 与 Gateway

### [ ] TASK-I01：MCP 配置 revision

**任务**：将当前 `Agent.mcpConfig` JSON 迁移为引用版本化配置；保存 transport、endpoint、host allowlist、批准工具和 secret reference。

**验收**：TaskEnvelope 只包含 revision/digest，不包含 secret；配置更新不影响运行中 Run。

### [ ] TASK-I02：工具发现与 schema 固定

**任务**：使用官方 MCP SDK 执行 `tools/list`，canonicalize schema 并计算 digest，与管理员批准版本比较。

**验收**：同名工具 schema 变化 100% 拒绝；工具缺失按 failure policy 处理；发现结果有审计记录。

### [ ] TASK-I03：Task-scoped MCP Gateway

**任务**：限制调用次数、并发、超时、响应大小、重定向和 host；即时解析并注入凭据；统一 ToolResult。

**验收**：凭据不出现在日志、事件和 Artifact；越权 host、超时、超限响应被拒绝；每任务/Server 并发限制有效。

### [ ] TASK-I04：MCP 故障与结果未知处理

**验收**：只读调用可按策略重试；写调用断线且无幂等能力时进入 BLOCKED；Runtime 恢复不会重复未知写操作。

## 15. Epic J：多 Agent DAG 与 Barrier

### [ ] TASK-J01：ExecutionPlan schema

**任务**：定义 node、dependsOn、failurePolicy、runtime requirements、budget 和 barrier；校验 DAG 无环且引用完整。

**验收**：循环依赖、缺失节点、负预算、超父预算计划被拒绝；合法 DAG 序列化稳定。

### [ ] TASK-J02：父子 Run 调度

**任务**：节点依赖满足后原子进入 READY；每个子 Run 冻结独立快照、预算、租约和事件流。

**验收**：依赖未完成的节点不能 claim；父取消传播到未完成子 Run；子 Run 不共享模型消息数组和工具计数器。

### [ ] TASK-J03：Barrier 与失败策略

**任务**：实现 ALL、ANY、QUORUM、REQUIRED；实现 FAIL_FAST、CONTINUE、OPTIONAL。

**验收**：每类 barrier 有并发集成测试；OPTIONAL 失败不阻止汇总；FAIL_FAST 取消尚未开始的依赖节点。

### [ ] TASK-J04：结构化 Handoff 与 Aggregator

**任务**：子 Run 输出 `summary/facts/decisions/artifacts/warnings/unresolved`；Aggregator 只消费结构化结果。

**验收**：完整子日志不进入父上下文；Artifact 权限重新验证；父任务只在 barrier 满足后完成。

### [ ] TASK-J05：多维配额

**任务**：实现 global、room、user、agent、provider、runtime、MCP Server 配额，禁止无界 `Promise.all`。

**验收**：压力测试中各维度最大并发不越界；Supervisor 每房间保持串行；配额释放无泄漏。

## 16. Epic K：外部 Runtime Daemon 兼容层

本 Epic 在自建 Runtime 稳定后执行，不阻塞聊天/业务 Agent 首发。

### [ ] TASK-K01：Daemon 注册、心跳和 claim API

**任务**：短期任务凭证、capability/version 注册、WebSocket wake、HTTP polling fallback；Daemon 不直连业务数据库。

**验收**：过期凭证和不匹配 capability 无法 claim；断开 WebSocket 后 polling 可恢复；心跳过期 Runtime 不再接收新任务。

### [ ] TASK-K02：Workspace 管理

**任务**：每 Run 独立目录、ephemeral/durable、大小限制、受管理 context marker、Artifact 上传和清理。

**验收**：路径穿越、symlink 越界、超额写入被拒绝；失败保留策略符合 WorkspaceSpec。

### [ ] TASK-K03：CLI Adapter 与进程树取消

**任务**：按独立适配器支持 Codex/Claude；解析事件；保存真实 session ID；SIGTERM grace 后 SIGKILL 进程组。

**验收**：取消后无子进程和 MCP 子进程；session 实体不存在时不写失效 ID；fresh retry 披露 continuity gap。

### [ ] TASK-K04：代码执行沙箱

**任务**：独立 `CODE_RUNTIME`、非 root 容器、只读根、每 Run workspace、资源限制、默认断网、无 Docker socket。

**验收**：逃逸/越权测试、网络 allowlist、资源耗尽、取消残留检查全部通过后才能生产启用。

## 17. Epic L：可观测性、运维与发布

### [ ] TASK-L01：结构化日志与指标

**任务**：记录 queue delay、run/turn/tool latency、first token、Token/cost、approval wait、lease lost、recovery、context compression。

**验收**：可按 runId 关联全链路；日志脱敏测试覆盖 key、Authorization、Cookie 和 MCP token。

### [ ] TASK-L02：管理台运行详情

**任务**：扩展 `AgentRunsTab`，展示 Runtime、状态、Turn、工具、审批、Artifact、usage、continuity 和父子 DAG。

**验收**：普通房间成员只能查看有权限的 Run；管理员可审计但看不到 secret；大事件列表分页。

### [ ] TASK-L03：故障演练

覆盖 Worker crash、数据库短断、Provider timeout、MCP schema drift、租约丢失、重复事件、Artifact 失败、父子取消和非幂等 outcome unknown。

**验收**：每个演练有预期终态、恢复时间、数据一致性检查和审计证据；不存在无限 RUNNING Run。

### [ ] TASK-L04：容量与性能测试

**首版指标**：

- 20 个 Embedded Run 全局并发时，claim 不重复。
- delta 聚合不超过配置写入频率。
- 队列有任务且有容量时，数据库轮询模式下 p95 claim delay 小于 3 秒。
- 取消信号到 AbortController 触发 p95 小于 2 秒，不含不可控远端完成时间。

### [ ] TASK-L05：灰度发布与回滚

**任务**：按房间/Agent/runtime kind 灰度；准备 migration、feature flag、Worker 回滚和数据兼容 runbook。

**验收**：回滚不会要求删除新表或丢弃事件；新 Run 可切回 legacy，已进入工具副作用阶段的 Run 不允许跨 Runtime 静默续跑。

## 18. 跨阶段测试矩阵

| 层级 | 必测内容 |
| --- | --- |
| Unit | canonical digest、schema、状态转移、错误分类、预算、policy、DAG |
| DB integration | claim、lease generation、event sequence、checkpoint、幂等键、审批竞争 |
| Provider integration | stream、tool calls、usage、timeout、AbortSignal、错误归一化 |
| Tool/MCP integration | schema drift、secret 注入、host/size/timeout、outcome unknown |
| E2E | 消息到最终回复、图片、Supervisor、审批、取消、恢复、多 Agent 汇总 |
| Security | prompt injection、路径穿越、SSRF、secret 泄漏、越权工具、沙箱逃逸 |
| Resilience | Worker crash、通知丢失、重复事件、数据库短断、租约丢失 |
| Performance | claim delay、delta 写放大、并发配额、连接池与内存 |

每个 Epic 合并前至少运行：

```bash
npm run prisma:validate
npm run typecheck
npm run lint
npm test
npm run build
```

涉及 Runtime Worker、MCP 或容器时还必须运行对应集成测试和 compose smoke test。

## 19. Definition of Done

单个 Task 只有满足以下条件才可标记完成：

- 代码、migration、配置和文档同步提交。
- 正向、负向、并发或故障测试与风险相匹配。
- 错误码、事件和审计字段稳定且已记录。
- 不引入明文 secret、无界并发、无界重试或不可恢复内存状态。
- lint、typecheck、测试和构建通过。
- 已说明兼容性、回滚方式和剩余风险。

里程碑只有满足以下条件才可关闭：

- 本里程碑全部阻塞级 Task 完成。
- 入口/退出门禁有自动化证据。
- 下游依赖的协议和 schema 已冻结版本。
- 无 P0/P1 已知缺陷；P2 缺陷有 owner 和计划。

## 20. 推荐执行顺序

```text
A01-A03
  -> B01-B03
  -> C01-C04
  -> D01-D03
  -> E01-E04
  -> G01-G05
  -> F01-F04
  -> H01-H05
  -> I01-I04
  -> J01-J05
  -> L01-L05
  -> K01-K04（可选扩展）
```

`F` 可以在 `G` 的基础 Loop 稳定后与部分 `G` 收尾并行；`I` 必须在 Tool Policy 和审批完成后开始；`J` 必须建立在独立、可恢复的单 Run 之上；`K` 不应拖延自建 Runtime 的首个可用版本。

## 21. 首个可交付版本

首个生产候选建议只包含 M0-M5：

- 统一协议和不可变 TaskEnvelope。
- 独立自建 Runtime Worker。
- OpenAI-compatible 多 Turn Loop。
- Context Budget 与 Skill Bundle。
- 只读内部工具、Policy 和审批框架。
- Turn/checkpoint 恢复、取消、事件和基础审计。

首版明确不包含外部 CLI Daemon、任意代码执行、复杂 MCP 写工具和多 Agent DAG。这样可以先验证最关键的恢复、幂等、权限和运行成本，再扩大执行能力。

## 22. 主要风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `service.ts` 一次性拆分导致行为回归 | A01 先锁行为，兼容 facade 和 feature flag 小步迁移 |
| 数据库被流式 delta 写爆 | 聚合写入、Artifact 外部化、指标和压测门禁 |
| Worker 崩溃重复副作用 | Turn/Tool 事务边界、幂等键、outcome unknown 阻塞 |
| Prompt injection 越权 | 指令来源分层，Policy 与模型输出完全分离 |
| MCP schema/凭据风险 | revision、schema digest、task-scoped gateway、secretRef |
| 多 Agent 失控扩张 | DAG 校验、父预算、多维配额、barrier |
| 长迁移双系统不一致 | 禁止同 Run 双执行，按新 Run 灰度，稳定事件协议 |
| 过早建设编码沙箱拖慢交付 | K Epic 后置，首版不提供任意代码执行 |

## 23. 完成判定

整套方案完成时必须证明：

1. Runtime 切换不要求修改聊天室消息业务逻辑。
2. 每个 Run 可追溯到固定 Agent、模型、Context、Skill、MCP、Policy 和 Runtime 版本。
3. Worker 或 Runtime 崩溃后可从已提交边界恢复，且不重复消息和已知副作用。
4. 未批准工具、schema 漂移、权限撤销和预算超限均被阻断。
5. secret 不进入任务、模型上下文、事件、日志和 Artifact。
6. 取消、审批、重试、多 Agent barrier 和 continuity gap 均可查询与审计。
7. 所有生产能力通过 lint、typecheck、单元、集成、E2E、安全和故障演练门禁。
