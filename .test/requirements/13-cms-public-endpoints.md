# 13 CMS 公开端点 / 健康 / 就绪 / 后台 / 首页（API）

覆盖顶层 Payload 端点（`endpoints/rollback-intents.ts`、`edition-workflow.ts`、`url-records.ts`）、健康与就绪路由（`app/api/**`）、后台与公开首页（`app/(payload)`、`app/(public)`）。已有自动化：`test/unit/rollback-intents-endpoint.test.ts`、`test/unit/edition-workflow-endpoint.test.ts`、`test/unit/url-records-endpoint.test.ts`、`test/unit/readiness.test.ts`；公网冒烟 `browser-checks.mjs`。

## 回滚意图端点 `POST /api/rollback-operations/intents`

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | API-P0-001 | P0 | publisher 合法创建意图 | 201 | 生成 rollback-intent 行、approvedBy 记录 | 关联 SVC |
| [ ] | API-P0-002 | P0 | body 非法 | 400 `ROLLBACK_INTENT_BODY_INVALID` | 无写入 | 已有自动化 |
| [ ] | API-P0-003 | P0 | 目标 release 状态不匹配 | 409 `ROLLBACK_RELEASE_STATE_MISMATCH` | 无写入 | NOT_RUN |
| [ ] | API-P0-004 | P0 | 非 publisher 角色 | 403 | 无写入 | NOT_RUN |
| [ ] | API-P1-005 | P1 | site/tenant/release 不存在或跨租户 | 对应错误码 | 无写入 | 关联 SVC approval |

## 版本工作流端点

`POST /api/editions/:id/draft-from-published` 与 `POST /api/editions/:id/workflow-transitions`。

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | API-P0-010 | P0 | draft-from-published 合法 | 200 `{workflowStatus:"draft"}` | 生成 draft 版本 | 关联 DOM |
| [ ] | API-P0-011 | P0 | 非法 id | 400 `EDITION_WORKFLOW_ID_INVALID` | 无副作用 | NOT_RUN |
| [ ] | API-P0-012 | P0 | 未认证 | 401 `_UNAUTHENTICATED` | 拒绝 | NOT_RUN |
| [ ] | API-P0-013 | P0 | body 非法 | 400 `_BODY_INVALID` | 拒绝 | NOT_RUN |
| [ ] | API-P0-014 | P0 | actor 无效/租户不匹配 | 403（ACTOR_INVALID/TENANT_MISMATCH） | 拒绝 | NOT_RUN |
| [ ] | API-P0-015 | P0 | transitions 合法 target 序列（draft→generating→review→approved→compiled→published→archived） | 200 每步 workflowStatus 推进 | 状态机合法边 | 关联 DOM |
| [ ] | API-P0-016 | P0 | transitions 非法跳变（如 draft→published） | 409 | 状态不变 | NOT_RUN |
| [ ] | API-P1-017 | P1 | compiled target 需 compiledReleaseId | 缺失则拒绝 | 校验 | NOT_RUN |
| [ ] | API-P1-018 | P1 | 角色不足执行 transition | 403 | 拒绝 | 关联 RBAC |

## URL 改名端点 `POST /api/url-record-operations/:id/rename`

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | API-P0-020 | P0 | editor/publisher 合法改名（pathname 以 / 开头） | 200 | 旧路径→gone/redirect，新路径 active | 关联 SVC/DOM |
| [ ] | API-P0-021 | P0 | 非法 id | 400 `URL_RECORD_ID_INVALID` | 无副作用 | NOT_RUN |
| [ ] | API-P0-022 | P0 | 未认证 | 401 | 拒绝 | NOT_RUN |
| [ ] | API-P0-023 | P0 | 角色不足（reviewer 等） | 403 `_RENAME_FORBIDDEN` | 拒绝 | NOT_RUN |
| [ ] | API-P0-024 | P0 | 跨租户目标 | 403 `_TENANT_MISMATCH` | 拒绝 | NOT_RUN |
| [ ] | API-P1-025 | P1 | pathname 不以 / 开头 | 400 body invalid | 拒绝 | NOT_RUN |
| [ ] | API-P1-026 | P1 | 改名冲突/保留路径 | 409 `UrlRegistryError` | 无副作用 | 关联 DOM url |

## 健康 `GET /api/health`

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | API-P0-030 | P0 | 请求健康 | 200 `{"status":"alive"}` | force-dynamic、无依赖 | PASS_FULL 260822 |
| [x] | API-P2-031 | P2 | 健康端点无鉴权即可访问 | 200 | 供隧道/监控探测 | PASS_FULL 260822（浏览器内 fetch） |

## 就绪 `GET /api/readiness`

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | API-P0-040 | P0 | PG+RustFS 均正常 | 200 status=ready，两依赖 ready | 探针实际连库/列桶 | 公网 PASS 260822 |
| [ ] | API-P0-041 | P0 | PG 库/schema 不符 | 503 `POSTGRES_STATE_INVALID` | 探针检出 | 已有 readiness 单测 |
| [ ] | API-P0-042 | P0 | PG 认证失败（28P01） | 503 `POSTGRES_ACCESS_DENIED` | — | NOT_RUN |
| [ ] | API-P0-043 | P0 | PG 不可达 | 503 `POSTGRES_UNAVAILABLE` | — | NOT_RUN |
| [ ] | API-P0-044 | P0 | RustFS 403 | 503 `RUSTFS_ACCESS_DENIED` | ListObjectsV2 被拒 | NOT_RUN |
| [ ] | API-P0-045 | P0 | RustFS 不可达 | 503 `RUSTFS_UNAVAILABLE` | — | NOT_RUN |

## 后台 Admin（`(payload)`）

> 侧栏应显示 **12 个集合**；`outbox-events`/`idempotency-records` 为服务自有（read 全拒），
> by design 不在侧栏且管理页 404（见 10 文档 COL-P1-122/133）。
> `admin.avatar: "default"`（260822 修复）消除外部 Gravatar 依赖，认证页应无第三方请求失败。

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | API-P0-050 | P0 | `/admin` 生产渲染 | 200，标题 `Dashboard | Geo Foundry`，客户端挂载 | 无 import map 缺失日志 | PASS_FULL 260822（UX 版本，hard-errors=0） |
| [x] | API-P0-051 | P0 | `/admin/login` 表单渲染 | Geo Foundry 品牌/引导语 + Email/Password/Forgot/Login 可见，无 console error | S3ClientUploadHandler 在 import map | PASS_FULL 260822（WebBridge+Playwright 双核验） |
| [x] | API-P0-052 | P0 | 登录成功进入 Dashboard | Operations workspace + 侧栏恰 12 集合，服务自有 2 集合不在侧栏 | 会话建立、仪表盘 query 遵守 access scope | PASS_FULL 260822（扩展回归 17/17） |
| [x] | API-P1-053 | P1 | 12 个集合列表页可打开 | 无空白、无 console error、行数与库一致 | RSC+客户端一致 | PASS_FULL 260822（rows=7/2/3/0/6/6/0/0/0/0/0/0） |
| [x] | API-P1-055 | P1 | 服务自有 2 集合管理页 | HTTP 404（by design） | read 全拒 → notFound | PASS_FULL 260822，关联 COL-P1-122/133 |
| [x] | API-P2-054 | P2 | Media 上传控件（S3 handler）可用 | 创建表单 file input 存在 + 拖拽区可见（editor） | 关联 COL-P0-060 | PASS_FULL 260822 |
| [x] | API-P2-056 | P2 | 认证页无外部 Gravatar 请求 | 无 gravatar.com 请求/超时 | `admin.avatar=default` | PASS_FULL 260822（修复后复验） |

## 公开首页（`(public)`）

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | API-P0-060 | P0 | 访问 `/` | 200，标题 `Geo Foundry`，主标题 `Content operations workspace` | 静态渲染、不再跳 `/admin` | PASS_FULL 260822 |
| [x] | API-P1-061 | P1 | 首页 `Open administration` 链接 | 指向 `/admin` | — | PASS_FULL 260822 |
| [x] | API-P1-062 | P1 | 未知路径 `/definitely-not-a-page` | 404 | — | PASS_FULL 260822 |
| [x] | API-P2-063 | P2 | 首页响应式（4 视口） | 布局正常、无横向溢出 | — | PASS_FULL 260822（1440/1024/768/375） |
