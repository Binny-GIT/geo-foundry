# 12 CMS 内部零信任端点与守卫（INT）

覆盖 `apps/cms/src/endpoints/internal/**`。全部端点经 `withInternalGuards`（`guards.ts`）包裹，注册于 `INTERNAL_OPERATIONS`（`openapi.ts`）。基路径 `/api`。权威来源：`guards.ts`（守卫规则 + 错误码→HTTP 映射）、`contracts.ts`（zod body + 正则）。已有自动化：`test/unit/internal-endpoints.test.ts`、`test/unit/internal-contracts.test.ts`、`test/integration/internal-endpoints.test.ts`。

## 守卫横切（对每个端点均适用，至少抽样验证）

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | INT-P0-001 | P0 | 缺失/非法 `x-request-id`（不满足 `[A-Za-z0-9._-]{8,64}`） | 400 `INTERNAL_REQUEST_ID_INVALID` | 不进入处理器 | 已有自动化 |
| [ ] | INT-P0-002 | P0 | OPTIONS 预检 | 204，含 CORS 头 | 无副作用 | NOT_RUN |
| [ ] | INT-P0-003 | P0 | 非服务身份（普通用户/匿名） | 401 `INTERNAL_UNAUTHENTICATED` | 拒绝 | NOT_RUN |
| [ ] | INT-P0-004 | P0 | 服务身份但 role≠content-service | 403 `INTERNAL_FORBIDDEN` | 拒绝 | NOT_RUN |
| [ ] | INT-P0-005 | P0 | 超过速率限制（默认 600/min/用户:操作） | 429 `INTERNAL_RATE_LIMITED` + retry-after | 计数器生效 | NOT_RUN |
| [ ] | INT-P0-006 | P0 | 非法 `x-operation-id`（不满足 `{4,128}`） | 400 | 拒绝 | NOT_RUN |
| [ ] | INT-P0-007 | P0 | body 超过大小上限（默认 1 MiB，content-length 与实读双检） | 413 `INTERNAL_BODY_TOO_LARGE` | 拒绝 | NOT_RUN |
| [ ] | INT-P0-008 | P0 | 非 JSON / zod 校验失败 body | 400 `INTERNAL_BODY_INVALID` + issues[] | 拒绝 | NOT_RUN |
| [ ] | INT-P0-009 | P0 | Origin 不在 `CMS_INTERNAL_ALLOWED_ORIGINS` | CORS 拒绝 | 无 ACAO | NOT_RUN |
| [ ] | INT-P1-010 | P1 | 响应头含 `x-request-id`、`vary: Origin` | 头正确回显 | — | NOT_RUN |
| [ ] | INT-P1-011 | P1 | 配置解析 `parseInternalEndpointConfig`（自定义 body/rate 限额） | 生效 | env→限额一致 | NOT_RUN |

## 端点契约（method / path / 场景 / 期望）

每端点至少：happy path + body 校验失败 + 领域错误码分支。

| 已测 | ID | 优先级 | 端点 | 方法 | 场景 | 期望 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | INT-P1-020 | P1 | `/internal/editions/:id/input` | GET | 有效 edition | 200 编辑输入载荷 |
| [ ] | INT-P1-021 | P1 | `/internal/editions/:id/input` | GET | 不存在 id | 领域错误→对应状态 |
| [ ] | INT-P1-022 | P1 | `/internal/sites/:id/compile-snapshot` | GET | 有效 site | 200 快照（routes/listings） |
| [ ] | INT-P1-023 | P1 | `/internal/editions/:id/versions` | POST | 合法 draftVersionBody | 200/201 写入草稿版本 |
| [ ] | INT-P1-024 | P1 | `/internal/editions/:id/versions` | POST | 缺字段 | 400 body invalid |
| [ ] | INT-P1-025 | P1 | `/internal/editions/:id/assessments` | POST | 合法 assessmentBody | 记录评估、immutable | 关联 SVC/COL |
| [ ] | INT-P1-026 | P1 | `/internal/editions/:id/compile-results` | POST | 合法 compileResultBody | 记录编译结果 |
| [ ] | INT-P0-027 | P0 | `/internal/editions/:id/publish-requests` | POST | 合法 publishRequestBody | 发布请求受理、状态推进 |
| [ ] | INT-P0-028 | P0 | `/internal/rollback-intents/consume` | POST | 合法消费 | 意图消费、幂等 |
| [ ] | INT-P0-029 | P0 | `/internal/rollback-intents/consume` | POST | 已消费再次消费 | `ALREADY_CONSUMED`→409 |
| [ ] | INT-P0-030 | P0 | `/internal/sites/:id/releases/published` | POST | releaseReceiptBody | 记录 published release |
| [ ] | INT-P0-031 | P0 | `/internal/releases/rollback-receipt` | POST | releaseReceiptBody | 记录回滚回执 |
| [ ] | INT-P1-032 | P1 | `/internal/editions/:id/embeddings` | POST | embeddingStoreBody（1536 维） | 存储嵌入 |
| [ ] | INT-P1-033 | P1 | `/internal/editions/:id/embeddings` | POST | 维度错误向量 | 校验错误码 |
| [ ] | INT-P1-034 | P1 | `/internal/editions/:id/similarity` | POST | similarityQueryBody | 200 相似结果排序 |
| [ ] | INT-P0-035 | P0 | `/internal/operations/submit` | POST | 首次 submitOperationBody | 202 created |
| [ ] | INT-P0-036 | P0 | `/internal/operations/submit` | POST | 相同 idempotencyKey 重复 | 200 existing、不新增 |
| [ ] | INT-P1-037 | P1 | `/internal/operations/non-terminal` | GET | 列出未终结操作 | 200 列表 |
| [ ] | INT-P1-038 | P1 | `/internal/operations/:operationId` | GET | 存在/不存在 | 200 / NOT_FOUND |
| [ ] | INT-P0-039 | P0 | `/internal/operations/:operationId/stages/start` | POST | startOperationStageBody | 阶段开始、状态迁移 |
| [ ] | INT-P0-040 | P0 | `/internal/operations/:operationId/stages/complete` | POST | completeOperationStageBody | 阶段完成 |
| [ ] | INT-P0-041 | P0 | `/internal/operations/:operationId/cancel` | POST | cancelOperationBody | 取消、终态 |
| [ ] | INT-P0-042 | P0 | 阶段非法迁移（如未 start 就 complete） | 领域错误→409 | 状态不变 | 关联 DOM operation |

## 错误码→HTTP 状态映射矩阵

`guards.ts` 为 EditionWorkflow、OperationsLedger、RollbackIntent、ReleaseRegistry、Embedding 错误各定义 ~10-15 码的映射。每类至少覆盖：一个 400、一个 403、一个 404、一个 409。

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | INT-P1-050 | P1 | EditionWorkflow 各错误码逐一触发 | 状态码与 guards 表一致 | 无状态副作用 | 建议表驱动 |
| [ ] | INT-P1-051 | P1 | OperationsLedger 各错误码逐一触发 | 同上 | — | NOT_RUN |
| [ ] | INT-P1-052 | P1 | RollbackIntent 各错误码逐一触发 | 同上 | — | NOT_RUN |
| [ ] | INT-P1-053 | P1 | ReleaseRegistry 各错误码逐一触发 | 同上 | — | NOT_RUN |
| [ ] | INT-P1-054 | P1 | Embedding 各错误码逐一触发 | 同上 | — | NOT_RUN |
| [ ] | INT-P2-055 | P2 | 未映射异常兜底 | 500 且不泄露内部细节 | 日志含 request-id | NOT_RUN |

## OpenAPI 文档

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | INT-P2-060 | P2 | `internalOpenApiDocument` 生成 | v1.0.0、security=serviceApiKey | 与实际端点集合一致 | NOT_RUN |
| [ ] | INT-P2-061 | P2 | 契约与 content-client schemas 对齐 | 请求/响应 shape 一致 | 关联 CLI | NOT_RUN |
