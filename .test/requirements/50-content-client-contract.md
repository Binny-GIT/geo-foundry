# 50 内容契约客户端（CLI）

覆盖 `packages/content-client/src/*`。`ContentServiceClient` 封装 CMS 内部端点的 17 个操作，加 zod 契约。已有自动化：client、client-contract。以 `PASS_BACKEND` 计。与 `12-cms-internal-endpoints.md` 对偶：此处从客户端视角，那边从服务端视角。

## 客户端操作（17）

每操作至少：成功编码/解码 + 错误映射 + 超时/重试（若支持）。

| 已测 | ID | 优先级 | 操作 | 场景 | 期望 |
| --- | --- | --- | --- | --- | --- |
| [ ] | CLI-P1-001 | P1 | `getEditionInput` | 正常/404 | 返回载荷 / `ContentClientError` |
| [ ] | CLI-P1-002 | P1 | `getCompileSnapshot` | 正常 | 快照解析 |
| [ ] | CLI-P1-003 | P1 | `writeDraftVersion` | 合法 body | 200 |
| [ ] | CLI-P1-004 | P1 | `recordAssessment` | 合法 body | 记录 |
| [ ] | CLI-P1-005 | P1 | `recordCompileResult` | 合法 body | 记录 |
| [ ] | CLI-P0-006 | P0 | `consumeRollbackIntent` | 首次/已消费 | 成功 / 冲突码 |
| [ ] | CLI-P0-007 | P0 | `recordPublishedRelease` | 合法 receipt | 记录 |
| [ ] | CLI-P0-008 | P0 | `recordRollbackReceipt` | 合法 receipt | 记录 |
| [ ] | CLI-P0-009 | P0 | `requestPublish` | 合法 | 受理 |
| [ ] | CLI-P0-010 | P0 | `submitOperation` | 首次/重复 idempotencyKey | 202 / 200 existing |
| [ ] | CLI-P1-011 | P1 | `getOperation` | 存在/不存在 | 200 / 错误 |
| [ ] | CLI-P0-012 | P0 | `startOperationStage` | 合法/非法阶段 | 推进 / 冲突 |
| [ ] | CLI-P0-013 | P0 | `completeOperationStage` | 合法/未 start | 完成 / 冲突 |
| [ ] | CLI-P0-014 | P0 | `cancelOperation` | 合法 | 终态 |
| [ ] | CLI-P1-015 | P1 | `listNonTerminalOperations` | 列表 | 结果 |
| [ ] | CLI-P1-016 | P1 | `storeEmbedding` | 1536 维/维度错误 | 成功 / 校验错误 |
| [ ] | CLI-P1-017 | P1 | `findSimilarEditions` | 查询 | 排序结果 |

## 契约与错误

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CLI-P0-020 | P0 | 客户端 zod schemas 与服务端 contracts 对齐 | 请求/响应 shape 一致 | 无字段漂移 | 关联 INT-P2-061 |
| [ ] | CLI-P1-021 | P1 | `ContentClientError` 携带状态码/错误码 | 可区分 4xx/5xx/领域码 | — | client |
| [ ] | CLI-P1-022 | P1 | `CallOptions`（request-id/operation-id/超时） | 头正确注入 | 关联 INT 守卫 | NOT_RUN |
| [ ] | CLI-P1-023 | P1 | `ContentClientConfig` 基址/鉴权 | 服务身份鉴权通过 | — | NOT_RUN |
| [ ] | CLI-P2-024 | P2 | 各 schema：compileSnapshot/evaluate/generate/publish/rollback/recordReleaseReceipt/consumeRollbackIntent | 边界值校验 | — | NOT_RUN |
