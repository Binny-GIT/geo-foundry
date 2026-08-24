# 14 CMS 服务层（SVC）

覆盖 `apps/cms/src/services/*` 与 `src/outbox/*`。这是控制面业务逻辑核心，多由内部端点调用。已有自动化：`test/integration/*`（edition-workflow、embeddings-*、operations、rollback-control-plane、url-registry、outbox-dispatcher 等）。

## 编译快照 compile-snapshot

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SVC-P1-001 | P1 | `buildCompileSnapshot(siteId,user)` 正常站点 | 返回 routes+listings | editions 映射正确、pathname 排序 | 已有 mappers 单测 |
| [ ] | SVC-P1-002 | P1 | slugify/`mapEdition`/`deriveRoutes`/`deriveListings` | 各映射结果稳定 | UTC instant 强制 | NOT_RUN |
| [ ] | SVC-P1-003 | P1 | 跨租户 user 请求他站点快照 | 拒绝/隔离 | scope 命中 | 关联 RBAC |
| [ ] | SVC-P2-004 | P2 | 空站点/无 edition | 返回空但结构合法 | — | NOT_RUN |

## 版本工作流 edition-workflow / edition-integration

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SVC-P0-010 | P0 | `transitionEdition` 合法迁移 | 成功、返回新状态 | 状态机合法边、审计 actor 序列化 | 集成已覆盖 gating |
| [ ] | SVC-P0-011 | P0 | 非服务身份/跨租户调用 | `EditionWorkflowError`（ACTOR_INVALID/TENANT_MISMATCH） | 拒绝 | NOT_RUN |
| [ ] | SVC-P0-012 | P0 | `createDraftFromPublished` | 生成 draft，input-hash 记录 | 幂等/一致 | NOT_RUN |
| [ ] | SVC-P0-013 | P0 | `recordAssessment` 写入不可变评估 | 生成 quality-assessment | immutable、system clock | 关联 COL/CPL |
| [ ] | SVC-P1-014 | P1 | `readEditionInput`/`writeGeneratedDraft`/`recordCompileResult`/`requestPublish` | 各步正确落库+回执 | edition-integration 一致 | NOT_RUN |
| [ ] | SVC-P1-015 | P1 | edition-input-hash `canonicalize`/`hashEditionContent` | 相同内容同 hash、字段序无关 | 确定性 | NOT_RUN |

## 嵌入 embedding-store / embedding-similarity

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SVC-P0-020 | P0 | `storeEditionEmbedding` 1536 维 content/title | 成功 | 向量落 pgvector、anchor/key 正确 | 集成 embeddings-store |
| [ ] | SVC-P0-021 | P0 | 维度不符 `validateVector` | `EmbeddingStoreError` | 无写入 | NOT_RUN |
| [ ] | SVC-P1-022 | P1 | `findSimilarEditions` same-site | 按相似度排序 | 结果租户/站点隔离 | 集成 embeddings-similarity |
| [ ] | SVC-P1-023 | P1 | `findSimilarEditions` cross-domain | 依查询模式返回 | `explainSimilarityQuery` 一致 | NOT_RUN |
| [ ] | SVC-P2-024 | P2 | 相似度候选上限/空结果 | 合理边界 | — | NOT_RUN |

## 操作账本 operations-ledger

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SVC-P0-030 | P0 | `submitOperation` 首次 | 生成操作+idempotency 记录 | key/hash 落库 | 集成 operations |
| [ ] | SVC-P0-031 | P0 | 相同 idempotencyKey 重复 submit | 返回既有、不新增 | 单行、幂等 | 已有自动化 |
| [ ] | SVC-P0-032 | P0 | `startOperationStage`→`completeOperationStage` 合法序列 | 阶段推进 | 状态机合法、审计 | 关联 DOM |
| [ ] | SVC-P0-033 | P0 | 未 start 直接 complete / 重复 complete | `OperationsLedgerError` | 状态不变 | NOT_RUN |
| [ ] | SVC-P0-034 | P0 | `cancelOperation` | 终态取消 | 后续阶段被拒 | NOT_RUN |
| [ ] | SVC-P1-035 | P1 | `getOperation`/`listNonTerminalOperations` | 结果正确、隔离 | R scope | NOT_RUN |

## 发布注册 release-registry

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SVC-P0-040 | P0 | `recordPublishedRelease` | 生成 current release | manifestSha256/runtimeSiteId(`site-{n}`) 正确 | 集成 rollback-control-plane |
| [ ] | SVC-P0-041 | P0 | 重复/身份冲突（CAS） | `ReleaseRegistryError` 冲突码 | 无重复 current | NOT_RUN |
| [ ] | SVC-P0-042 | P0 | `recordRollbackReceipt` | 旧 current→rolled_back/superseded | 状态推进正确 | 关联 DOM release |
| [ ] | SVC-P1-043 | P1 | release 状态转移合法性 | 与 domain release 状态机一致 | — | NOT_RUN |

## 回滚 rollback-intents / rollback-intent-approval

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SVC-P0-050 | P0 | `createRollbackIntent`（publisher） | 生成意图 | approvedBy 记录、release 校验 | 关联 API-P0-001 |
| [ ] | SVC-P0-051 | P0 | 非 publisher / site 不存在 / 租户不符 / release 不符 | 对应 `RollbackIntentApprovalError` 码 | 无写入 | 逐码覆盖 |
| [ ] | SVC-P0-052 | P0 | `consumeRollbackIntent`（service） | 消费成功 | 状态 consumed | NOT_RUN |
| [ ] | SVC-P0-053 | P0 | consume 非服务/不存在/不匹配/已消费 | 对应 `RollbackIntentError` 码 | 无副作用 | 逐码覆盖 |

## URL 注册表 url-registry

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SVC-P0-060 | P0 | `reserveUrlRecord`→`activateUrlRecord` | reserved→active | 状态推进 | 集成 url-registry |
| [ ] | SVC-P0-061 | P0 | 保留路径预留 | 拒绝（RESERVED_PATHNAMES） | 无写入 | 关联 DOM |
| [ ] | SVC-P0-062 | P0 | `renameUrlRecord` | 旧路径 redirect/gone、新 active | 图不成环 | 关联 API-P0-020 |
| [ ] | SVC-P1-063 | P1 | `markUrlRecordGone` | active→gone | 状态正确 | NOT_RUN |
| [ ] | SVC-P1-064 | P1 | `retainActiveUrl` 内容更新保活 | 保持 active | — | NOT_RUN |
| [ ] | SVC-P1-065 | P1 | `sitemapEligibleUrls`/`buildSiteRegistry` | 仅合规 URL 入 sitemap | 关联 CMP sitemap | NOT_RUN |

## 事务性 outbox

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SVC-P0-070 | P0 | 业务写入与 outbox 事件同事务 | 要么都成、要么都回滚 | 无孤儿事件 | NOT_RUN |
| [ ] | SVC-P0-071 | P0 | dispatcher 派发 pending 事件 | 标记 dispatched | 幂等、至少一次 | 集成 outbox-dispatcher |
| [ ] | SVC-P1-072 | P1 | 派发失败重试 | 重试计数、不重复副作用 | — | NOT_RUN |
