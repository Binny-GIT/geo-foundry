# 60 执行面：Worker 与 Content-Service（WRK / CSVC）

覆盖 `apps/worker/*` 与 `apps/content-service/*`。BullMQ 流水线 + 操作提交 HTTP 服务。已有自动化：worker unit（flows、operation-processor、release-pipeline、triggers、worker-runtime）+ integration（worker-flows）；content-service（http/content-service-api、operations）。

## 队列与流程 flows

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | WRK-P0-001 | P0 | `operationFlowOf`/`enqueueOperationFlow` operationType→阶段job 映射 | evaluate→evaluation、generate→generation、publish→publish-gate、rollback→rollback-gate | 队列名+jobId 正确 | flows |
| [ ] | WRK-P0-002 | P0 | `operationStageJobId` 稳定性 | 相同操作阶段同 jobId | 幂等入队 | NOT_RUN |
| [ ] | WRK-P1-003 | P1 | 非法 operationType | `OperationFlowError` | 不入队 | flows |
| [ ] | WRK-P1-004 | P1 | `QUEUE_NAME` 映射 + `QUEUE_PREFIX=geo-foundry` | 队列前缀正确 | — | NOT_RUN |

## 运行时与处理器

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | WRK-P0-010 | P0 | `operationProcessor` 阶段包装（start/complete/fail、attempt 记录） | 账本正确推进 | 与 operations-ledger 一致 | operation-processor |
| [ ] | WRK-P0-011 | P0 | `createGenerationProcessor` 生成阶段 | 生成结果落库 | 关联 CPL/SVC | NOT_RUN |
| [ ] | WRK-P0-012 | P0 | `createEvaluationProcessor` 评估阶段 | 评估落库 | — | NOT_RUN |
| [ ] | WRK-P0-013 | P0 | `createCompileTriggerProcessor` compile-trigger | 触发编译计划 | 关联 release-pipeline | triggers |
| [ ] | WRK-P0-014 | P0 | `createPublishGateProcessor` publish-gate | 发布门通过/终止 | `terminalPublishErrorOf` 分类 | triggers |
| [ ] | WRK-P0-015 | P0 | `createRollbackGateProcessor` rollback-gate | 回滚门 | — | NOT_RUN |
| [ ] | WRK-P1-016 | P1 | `createEmbeddingProcessor` embedding | 生成嵌入 | 关联 SVC embedding | NOT_RUN |
| [ ] | WRK-P0-017 | P0 | `TerminalJobError` 永不重试 | 终止不重试 | 重试计数不增 | types |
| [ ] | WRK-P1-018 | P1 | 非终止错误重试 | 按策略重试 | attempt 递增 | operation-processor |

## 发布流水线 release-pipeline

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | WRK-P0-020 | P0 | `compileAndPlanRelease` | 生成 PlannedSiteRelease | releaseId 正确 | release-pipeline |
| [ ] | WRK-P0-021 | P0 | `publishPlannedRelease` 正常 | 制品上传+注册 published | S3 写入、release current | 关联 publisher |
| [ ] | WRK-P0-022 | P0 | 控制面失败后 replay | 幂等重放、无重复副作用 | release-pipeline 测试点 | release-pipeline |
| [ ] | WRK-P1-023 | P1 | `createWorkerArtifactStore`/`parseWorkerS3Options` | S3 配置正确 | — | NOT_RUN |

## Outbox 处理器与 reconcile

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | WRK-P1-030 | P1 | `createOutboxProcessor`/`editionEmbeddingJobId` | 派发 outbox→嵌入 job | 幂等 jobId | NOT_RUN |
| [ ] | WRK-P0-031 | P0 | `reconcileNonTerminalOperations` | 恢复未终结操作 | ReconcileReport 正确 | worker-runtime |
| [ ] | WRK-P1-032 | P1 | `parseWorkerRedisOptions` | Redis 配置正确 | — | NOT_RUN |
| [ ] | WRK-P1-033 | P1 | 集成：共享 Redis 全链路 | 各队列端到端流转 | worker-flows | worker-flows |

## Content-Service HTTP（CSVC）

| 已测 | ID | 优先级 | 端点 | 方法 | 场景 | 期望 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CSVC-P0-001 | P0 | `/healthz` | GET | 探活 | 200 |
| [ ] | CSVC-P1-002 | P1 | `/v1/openapi.json` | GET | 文档 | 200 契约 |
| [ ] | CSVC-P1-003 | P1 | `/v1/operations/{id}` | GET | 存在/不存在 | 200 / 错误 |
| [ ] | CSVC-P0-004 | P0 | `/v1/generate` | POST | 带 Idempotency-Key | 受理、canonical hash |
| [ ] | CSVC-P0-005 | P0 | `/v1/generate` | POST | 缺 Idempotency-Key | 拒绝 |
| [ ] | CSVC-P0-006 | P0 | `/v1/generate` | POST | 重复 Idempotency-Key | 幂等返回既有 |
| [ ] | CSVC-P0-007 | P0 | `/v1/evaluate` | POST | 合法/缺 key | 受理 / 拒绝 |
| [ ] | CSVC-P0-008 | P0 | `/v1/publish` | POST | 合法/缺 key | 受理 / 拒绝 |
| [ ] | CSVC-P0-009 | P0 | `/v1/rollback` | POST | 合法/缺 key | 受理 / 拒绝 |
| [ ] | CSVC-P1-010 | P1 | `CONTENT_SERVICE_ERROR_CODE` 错误映射 | 各错误码 | 正确响应 |
| [ ] | CSVC-P1-011 | P1 | 提交后经 worker 落 CMS 账本 | 端到端一致 | 关联 WRK/SVC | content-service-api |
