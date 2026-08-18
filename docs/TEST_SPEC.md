# Smart Chat 测试规格

日期：2026-08-18

## 1. 测试原则与环境

测试环境包含应用、独立 PostgreSQL、Redis、AI gateway stub 和 worker。每个测试生成独立用户/房间，禁止依赖执行顺序。CI 最低门禁为 lint、typecheck、unit、integration、E2E、安全扫描；容量与恢复 smoke 在发布候选阶段执行。

## 2. 单元测试

- Auth：邮箱规范化、Argon2 参数、session 创建/过期/撤销、统一错误映射。
- Policy：访客/成员/非成员/管理员权限矩阵，管理员不自动读取房间。
- Validation：昵称、头像 key、房间名、文本长度、控制字符和未知 content part。
- Mention：结构化 range、重复提及、已退出成员、普通成员与 assistant 的触发差异。
- Message：clientId 幂等、sequence 分配、cursor 编解码。
- AI：room-scoped context、条数/token 截断、配置快照、provider 映射、超时、重试分类、error code 和日志 redaction。
- AI 状态机：合法/非法状态转换、lease 回收、attempt 上限、手动重试幂等和 trigger/response 唯一。
- 并发提交相同/不同 retry idempotencyKey，验证 retry command 唯一、attempt 只推进一次且重复请求返回原结果。
- Admin：base URL allowlist、SSRF 拒绝、secret write-only、审计 before/after 脱敏。
- Mention canonicalization：NFC、UTF-16 半开区间、代理对/emoji、中文输入法、重叠/越界 range 和 contentParts 派生一致性。
- Mention normalization：分解重音字符在 NFC 后长度变化时，stored range 指向规范化文本。

## 3. 集成测试

- 注册、登录、Cookie、安全属性、退出及过期 session。
- 创建 room + creator membership + assistant membership 的事务原子性。
- 重复加入、退出后权限收回、非成员 IDOR。
- 退出后以旧 senderMemberId/clientId 重试被拒且无新消息；重新加入产生新 membership epoch，同 clientId 只在新 epoch 生成一条消息。
- 数据库验证退出行不可重新激活、rejoin 必须生成新 member id，发送命令的 senderMemberId 必须属于当前 session 用户和 active room membership。
- 访客目录验证 cursor 无重漏、搜索、PUBLIC/ACTIVE 过滤、最近活跃稳定排序，且不返回成员明细或消息正文。
- `GET/PATCH /api/me` 验证昵称/头像 key、认证和 IDOR；不能更新其他用户资料。
- message + mention + outbox 同事务；提交失败不残留部分数据。
- 两次相同 clientId 只产生一条消息；并发发送 sequence 唯一且有序。
- WebSocket 握手、订阅、退出后的撤权、Redis 跨实例 fan-out、按 cursor replay。
- 重复发布同一 eventId/roomSequence 时 realtime 和客户端只呈现一次；丢失 live event 后从 PostgreSQL replay 补齐并推进连续 ACK。
- worker 对重复 outbox、gateway timeout/429/5xx/坏响应的处理；AI run 和回复不重复。
- dispatcher 宕机于领取前/调用中/发布后、lease 过期、poison event/dead-letter、消费者重复投递；均不得重复 logical AI run 或最终回复。
- 制造旧 worker/dispatcher 租约过期后新 owner 领取的竞态；旧 owner 的 heartbeat/finalize CAS 必须影响 0 行。允许 Redis 重复 event，但去重后不得产生重复持久 side effect。
- 调用者在排队后退出房间时 AI run 以授权错误终止，payload 为空；重新加入不会自动恢复旧 run。
- 管理员重试原调用者已退出的 run 仍按原 callerMemberId 拒绝，不能借管理员权限构造上下文。
- context payload 只含当前房间允许字段，永不含其他房间、Cookie、密钥和管理配置。
- 管理员更新配置、乐观版本冲突、密钥轮换、健康检查和审计；普通用户均 403。
- `GET /api/admin/audit-logs` 验证 ADMIN auth、cursor/filter 与字段脱敏；普通用户 API 和 `/admin/audit` 页面均 403。
- 审计分页在多条相同 createdAt 和并发插入下按 `(createdAt DESC,auditId DESC)` 无重漏；验证 actor/action/time 索引与 append-only 约束。
- 删除/退出 assistant membership 返回稳定 409/403，数据库始终保持每房间恰好一个 active assistant。
- Phase 0 冻结留存策略后，验证 cleanup/tombstone、授权删除/导出、审计及 migration/backfill；未冻结时该 contract test 阻断 Phase 1。
- master key 缺失时 fail closed；旧/新 key 双版本轮换和数据库+密钥联合恢复成功；所有健康检查遵守 allowlist、重定向和超时策略。
- migration 正向、回滚或 forward-fix 策略在空库和带样例数据的库中验证。

## 4. E2E 测试

1. 两名用户分别注册；A 创建房间，B 从公开目录加入；双方实时聊天并刷新后历史一致。
2. 在输入框输入 `@`，用键盘选择 B；消息正确渲染且不触发 AI。
3. 选择“大聪明”，stub 返回流式/非流式响应；展示 started/completed，刷新后回复仍存在。
4. gateway 超时后展示失败与重试；重试不重复用户消息和已完成 AI 回复。
5. B 退出房间后，历史/发送/实时订阅均被拒绝；A 仍正常使用。
6. 普通用户无法进入后台或调用 admin API；管理员配置后客户端网络响应和 bundle 无 secret。
7. 断网后发送、恢复连接和补齐消息；无重复、无明显乱序。
8. 移动视口、键盘导航、中文输入法和 screen-reader live region 基础检查。
9. 用户更新自己的昵称/头像并刷新保持；修改他人资料失败。访客目录搜索/翻页排序稳定且不泄露消息。
10. 管理员查看审计分页/过滤；普通用户直达页面/API 失败，响应、bundle 和 trace 无 secret/ciphertext/provider payload。

## 5. 安全测试

- 注册/登录暴力尝试、用户名枚举和 session fixation。
- 所有 Cookie mutation 的 CSRF/origin 校验。
- 房间、消息、member、replay 和 WebSocket 的 IDOR/越权矩阵。
- 消息与昵称中的 HTML/script/双向控制字符；页面不得执行输入内容。
- AI base URL 的 localhost、私网、重定向、编码 IP 与 DNS rebinding 策略测试；仅显式 allowlist 的本地网关可用。
- Secret 扫描覆盖服务端日志、审计、HTTP 响应、浏览器 bundle、trace 和错误页。
- 消息、AI、auth、admin 独立限流；429 不破坏已持久化消息。

## 6. 负载、故障与恢复

- 建议首轮基线：200 并发连接、20 个活跃房间、每秒 50 条消息；Phase 0 在 `docs/SLO.md` 冻结窗口、样本量和阈值。容量测试自动断言 API P95 <300ms、广播 P95 <1s 以及所有非 deferred 阈值，并报告 P50/P95/P99、错误率和 event-loop lag。
- 注入 Redis 重连、worker 重启、gateway 慢响应/429/5xx、数据库事务失败和 WebSocket reconnect storm。
- 验证 Redis 故障期间 HTTP 持久化继续、实时进入 degraded、恢复后按 last ACK sequence 补齐；瞬时 AI delta 可丢但最终快照不可丢。
- 证明消息本体不丢失、outbox 可恢复、消费者幂等、AI backlog 有界并可告警。
- 执行数据库备份恢复和配置审计查询演练，记录 RPO/RTO；目标由产品/运维确认。

## 7. 可观测性验收

- HTTP、WebSocket、outbox 和 gateway 调用可用 requestId/traceId/aiRunId 关联。
- 指标至少包括 auth failures、active connections、message persist/broadcast latency、reconnect、AI latency/error、outbox depth/age、rate-limit。
- 日志和 trace 的自动扫描不出现 password、Cookie、Authorization、provider secret 和消息正文。
- readiness 区分 DB/Redis/worker 依赖，liveness 不因短暂 provider 故障误杀应用。
- 对 outbox oldest age、AI error rate、广播延迟和 auth 暴增执行一次告警演练。

## 8. 需求追踪矩阵

| PRD AC | 主要证明 |
| --- | --- |
| AC-01 | Auth unit + 注册/登录 integration + E2E 1 |
| AC-02 | Policy unit + IDOR integration + E2E 5 |
| AC-03 | Room transaction integration |
| AC-04 | 并发 message integration + E2E 1/7 |
| AC-05 | Mention unit/integration + E2E 2 |
| AC-06 | AI contract/integration + E2E 3/4 |
| AC-07 | Admin integration + E2E 6 + secret scan |
| AC-08 | 安全测试全集 |
| AC-09 | Validation unit + schema migration contract test |
| AC-10 | Room directory/profile integration + E2E 9 |
| AC-11 | Frozen SLO load assertions |

## 9. 发布阻断条件

任一高危越权/密钥泄露、重复/丢失消息、未处理 migration 失败、关键 AC 无证据、lint/typecheck/unit/integration/E2E 不通过，均阻止发布。留存策略和 `docs/SLO.md` 未冻结则阻止 Phase 1；冻结后相应 contract/load assertions 不通过则阻止发布。
