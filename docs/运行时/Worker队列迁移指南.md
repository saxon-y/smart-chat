# Agent Worker：数据库租约与消息队列迁移指南

## 1. 文档目的

本文解释 Smart Chat 当前传统 Agent Worker 的内部实现，重点说明数据库租约（lease）、事务 outbox、幂等和故障恢复；同时比较“数据库轮询”与“消息队列消费”两种调度方式，并给出可回滚的迁移方案。

本文讨论的是传统 `worker`（`npm run worker`）。新的 `runtime-worker` 使用相同的 PostgreSQL 权威状态原则，但执行面增加了 Agent Loop、工具、审批、MCP 和沙箱能力。

## 2. 当前架构

```text
浏览器 -> Next.js Web/API -> PostgreSQL
                           |
                           +-- AiRun / outboxEvent

传统 worker --HTTP polling--> /api/internal/agent-worker
       |
       +--> recoverPendingAiRuns(20)
       +--> AI Provider / Gateway
       +--> PostgreSQL 写回状态和 AI 消息
```

传统 worker 本身是一个长期运行的 Node 进程。它每隔一段时间调用内部接口，接口再批量恢复待处理的 `AiRun`。Worker 不直接暴露给浏览器，使用 `AGENT_WORKER_SECRET` 做服务间鉴权。

## 3. 数据库租约是什么

数据库租约是写入数据库的一段“处理所有权”，包含：

- `owner`：当前 Worker 实例和进程的标识。
- `leaseExpiresAt`：所有权的过期时间。
- `leaseGeneration`：每次重新领取递增的代数，用于防止旧 Worker 延迟写入。
- `status`：例如 `PENDING`、`CLAIMED`、`RUNNING`、`SUCCEEDED`、`FAILED_RETRYABLE`。

领取任务时，Worker 在一个数据库事务中使用条件更新或行锁：只有状态可处理、租约为空或已过期的记录才能被当前 Worker 更新为 `CLAIMED`。后续 heartbeat、结果写入和 finalize 继续检查 `runId + owner + leaseGeneration + leaseExpiresAt`。条件不满足时，更新影响行数为 0，旧 Worker 必须停止。

### 为什么需要租约

进程可能在调用 Provider 时崩溃、断网或被强制终止。租约让系统能够在超时后判断“这个任务已经没有可靠 owner”，再由其他 Worker 接管，而不需要依赖某个进程主动释放锁。

### 租约时间如何选择

租约过短会造成误回收：Provider 只是慢，任务却被第二个 Worker 接管。租约过长会造成恢复延迟。通常使用：

```text
lease duration > heartbeat interval * 3 + 最大预期网络抖动
```

Heartbeat 只能延长仍然拥有租约的任务，不能让已经过期的旧 owner 恢复写权限。所有时间判断应由数据库时间或统一时钟完成，避免机器时钟漂移。

## 4. 当前可靠性组件

### 4.1 AiRun 状态机

`AiRun` 是任务的权威状态。HTTP 请求重试、Worker 重启和客户端断线都不能直接决定最终结果，必须通过状态机和条件更新推进。

### 4.2 Transactional Outbox

业务事务同时写入业务状态和 `outboxEvent`。例如，创建 AI Run 和记录待通知事件在同一事务内提交，避免“任务已创建但通知丢失”或“通知已发送但任务未提交”。

Outbox 不是队列本身，而是可靠的待发布事件表。事件发布成功后仍需保留去重依据，因为网络重试可能造成重复投递。

### 4.3 幂等

同一个 `runId` 只能产生一个最终业务结果。重复 HTTP 请求、重复 outbox 事件和消息重投都必须安全。数据库唯一约束、状态条件更新和结果消息唯一键共同提供幂等边界。

### 4.4 客户端事件推送

聊天室事件接口从 outbox/事件表读取并通过 SSE 推送。SSE 断线后可以按游标重放，因此推送层不是权威消息存储。

## 5. 两种调度方案对比

| 维度 | 当前：数据库轮询 + 租约 | 目标：消息队列 + 数据库状态 |
|---|---|---|
| 组件数量 | 少，只需要 Web、Worker、PostgreSQL | 增加 Broker、Publisher、Consumer、监控 |
| 一致性 | 直接读取权威数据库，语义简单 | 队列是唤醒层，最终状态仍需数据库确认 |
| 延迟 | 受轮询间隔影响，通常为 0.5～2 秒 | 可做到近实时投递 |
| 吞吐 | 受数据库扫描和 claim 竞争影响 | Broker 擅长排队、分区和水平扩展 |
| 故障恢复 | 租约过期后自动重新领取 | 依赖 ack、重投、死信，同时仍需租约兜底 |
| 重复消息 | 主要由数据库查询/重试产生 | 至少一次投递下重复是常态，必须幂等 |
| 运维成本 | 低 | 高，需要 Broker 集群、容量和积压告警 |
| 调试难度 | 可直接查询任务和租约 | 需要同时查看数据库、队列、消费者和 offset |
| 适用阶段 | MVP、中低吞吐、单区域部署 | 高吞吐、多 Worker、低延迟和跨服务分发 |

消息队列不会自动提供 exactly-once。工程上应采用“至少一次投递 + 数据库幂等 + 租约 CAS”的组合。队列 ack 只代表消息已被消费者处理，不代表业务事务一定成功。

## 6. 推荐目标架构

```text
Next.js API
  -> DB transaction: AiRun + outboxEvent
  -> Outbox Publisher
  -> Message Broker (runId, eventId, schemaVersion)
  -> Worker Consumer
  -> DB conditional claim (租约)
  -> AI Provider
  -> DB transaction: result + status + agent_done outbox
  -> Broker/SSE publisher -> 浏览器
```

队列消息只携带最小字段：`eventId`、`runId`、`roomId`、事件类型、schema version 和重试计数。不能携带 API Key、完整聊天上下文或未经必要处理的用户隐私内容。

## 7. 分阶段迁移方案

### 阶段 0：建立基线

记录当前轮询间隔、claim 延迟、任务成功率、重试率、租约过期次数、Provider P95/P99、outbox backlog 和重复副作用。先补齐 `runId`、`eventId`、`attempt` 的结构化日志和指标。

### 阶段 1：引入 Outbox Publisher

不改变现有 Worker。新增 Publisher 定时扫描未发布 outbox，使用 `eventId` 去重后投递 Broker，并记录发布时间、次数和错误。数据库仍是唯一真相，Publisher 可重复运行。

### 阶段 2：实现队列 Consumer

Consumer 收到 `runId` 后不直接执行，先调用与现有 Worker 相同的数据库 claim 逻辑。claim 失败视为重复或已完成消息，直接 ack；claim 成功才执行 Provider。这样即使轮询 Worker 和 Consumer 并行，也不会同时拥有同一个 Run。

### 阶段 3：双写、单消费灰度

继续由旧轮询 Worker 执行全部任务，同时只让 Consumer 处理灰度房间或固定百分比的 Run。通过 `routingMode`、房间 ID 哈希或 Agent 配置选择 Consumer。对同一 Run 必须保证只有一个调度来源，避免双重唤醒造成无意义竞争。

### 阶段 4：扩大 Consumer 比例

逐步提高灰度比例，比较队列和轮询路径的成功率、P95 延迟、重复 claim、未知结果和积压。设置自动回滚阈值，例如错误率、积压时间或租约丢失率超过基线一定倍数。

### 阶段 5：关闭轮询入口

确认所有生产 Run 都由 Broker 投递，且 outbox backlog、死信和恢复演练达标后，将传统 Worker 的轮询频率降为仅恢复兜底，最终停用 `worker` profile。数据库 claim、租约和幂等代码继续保留，不能随队列迁移删除。

## 8. 失败、重试与回滚

- Provider 超时、429、5xx：由 Consumer 按退避策略重投，数据库记录 `attempt` 和 `nextRetryAt`。
- 非幂等操作结果未知：不得自动重放，Run 进入 `BLOCKED`，等待人工或业务策略处理。
- Consumer 崩溃：未 ack 的消息由 Broker 重投；租约过期后其他 Consumer 可接管。
- Broker 不可用：Publisher 保留 outbox，恢复后继续发布；必要时临时启用轮询兜底。
- 迁移回滚：停止 Consumer、保留未发布 outbox，恢复旧 Worker；由于 claim 和幂等键不变，不需要回滚业务数据。

## 9. 上线验收清单

- [ ] 相同 `runId` 的并发 Consumer 最多一个成功 claim。
- [ ] 重复消息不会产生重复 AI 消息或重复外部副作用。
- [ ] Worker 在 Provider 调用期间崩溃，租约过期后任务可恢复。
- [ ] Publisher 重启、Broker 重投、Consumer 重启均不会丢任务。
- [ ] 死信可查询、可人工重放，且重放仍经过幂等 claim。
- [ ] 密钥和完整上下文不出现在队列、日志和死信内容中。
- [ ] 队列积压、claim 延迟、租约丢失、重试和未知结果均有告警。
- [ ] 回滚到轮询 Worker 后，未完成 Run 能继续处理。

## 10. 结论

当前数据库轮询方案更适合项目早期：依赖少、调试直接、可靠性边界集中在 PostgreSQL。消息队列方案在吞吐、延迟和多消费者扩展方面更强，但会引入重复投递、积压、死信和额外运维复杂度。推荐先保留数据库租约和 outbox，将消息队列作为调度/唤醒层渐进引入，而不是把数据库状态迁移到队列中。
