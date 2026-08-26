# 执行矩阵（权威状态账本）

本文件是全量用例状态的**唯一权威账本**；明细文档提供用例语义。每轮执行后回写此处状态，并保持与明细文档一致。状态词见 `../README-test-loop.md`。

统计：各区域用例数与已完成（`PASS_FULL`/`PASS_BACKEND`）计数。初始全部 `NOT_RUN`。

| 区域 | 文档 | 用例数 | P0 | 已完成 | 备注 |
| --- | --- | --- | --- | --- | --- |
| COL | 10-cms-collections | 49 | 20 | 2 | 集合 CRUD/字段/钩子（+2 by-design 404 用例） |
| RBAC | 11-cms-access-rbac | 30 | 21 | 6 | 策略矩阵/会话/隔离（+UI 3 例 +self-scope 1 例） |
| INT | 12-cms-internal-endpoints | 40 | 20 | 0 | 内部端点+守卫+错误映射 |
| API | 13-cms-public-endpoints | 36 | 22 | 13 | 首页/后台/health/readiness 公网已验（+2 新用例） |
| SVC | 14-cms-services | 34 | 20 | 0 | 服务层业务逻辑 |
| UX | 15-admin-operations-ux | 26 | 12 | 0 | 登录、指挥台、站点工作区、工作流、权限与可用性 |
| DOM | 20-domain | 34 | 24 | 0 | 状态机/URL/不变量 |
| CMP | 30-compiler | 20 | 8 | 0 | 编译器 |
| CPL | 40-content-pipeline | 20 | 9 | 0 | 内容流水线 |
| CLI | 50-content-client-contract | 24 | 8 | 0 | 契约客户端 |
| WRK | 60-worker-and-content-service | 25 | 15 | 0 | worker+content-service |
| SITE | 70-example-sites | 22 | 9 | 0 | 示例站点 |
| OPS | 80-deploy-ops | 30 | 12 | 1 | 部署/运维/迁移 |
| XC | 90-cross-cutting | 20 | 8 | 0 | 横切质量 |

> 用例数为初稿规划值；新增用例时同步更新此表与对应明细。

## 已验证（260822 浏览器测试轮，镜像 `mk-dev-a6ae08e`）

执行器：`browser-checks.mjs`（冒烟 7/7）+ `browser-admin-tests.mjs`（深度 15/15，`admin-latest-run.json`）。
真实 Chromium 公网实测 + API A/B（Bearer 需 `Bearer ` 前缀）。截图 `.test/artifacts/`。

| ID | 结论 | 证据 |
| --- | --- | --- |
| API-P0-030 | PASS_FULL | `/api/health` → `{"status":"alive"}` |
| API-P2-031 | PASS_FULL | health 无鉴权可达（浏览器内 fetch） |
| API-P0-040 | PASS_FULL | `/api/readiness` → ready，PG+RustFS ready |
| API-P0-050 | PASS_FULL | Dashboard 客户端挂载，body-text=293，硬 console error=0 |
| API-P0-051 | PASS_FULL | 登录表单 Email/Password/Forgot/Login 可见，无 console error |
| API-P0-052 | PASS_FULL | 登录 → Dashboard，侧栏恰 12 集合，服务自有 2 集合隐藏 |
| API-P1-053 | PASS_FULL | 12 集合列表页行数与库一致（7/2/3/0/6/6/0/0/0/0/0/0），无 console error |
| API-P1-055 | PASS_FULL | outbox-events/idempotency-records 管理页 404（read 全拒 by design） |
| API-P2-054 | PASS_FULL | editor Media 创建页：file input 存在 + 拖拽区可见（S3 handler 挂载） |
| API-P2-056 | PASS_FULL | 认证页零 gravatar.com 请求（`admin.avatar=default` 修复后） |
| API-P0-060 | PASS_FULL | 首页 `Geo Foundry` / `Content operations workspace` |
| API-P1-061 | PASS_FULL | 首页 `Open administration` → `/admin` |
| API-P1-062 | PASS_FULL | 未知路径 404 |
| API-P2-063 | PASS_FULL | 4 视口（1440/1024/768/375）无横向溢出 |
| COL-P1-122 | PASS_FULL | idempotency-records 管理页 404、不在侧栏 |
| COL-P1-133 | PASS_FULL | outbox-events 管理页 404、不在侧栏 |
| COL-UI-DOC | PASS_FULL | contents 文档视图渲染（url=/admin/collections/contents/580） |
| RBAC-P0-021 | PASS_BACKEND | tenant-admin `/api/tenants` 仅见本租户 1 行（无 UI） |
| RBAC-P0-022 | PASS_BACKEND | editor `/api/sites` 仅本租户 2 行（无 UI） |
| RBAC-P0-023 | PASS_BACKEND | 双向跨租户零泄露（editor/foreign-admin 互不可见，无 UI） |
| RBAC-P1-024 | PASS_BACKEND | users self-scope 单测 15/15（`/api/users/me` 修复，无 UI） |
| RBAC-UI-001 | PASS_FULL | editor users 列表仅见自己 1 行（self-scope） |
| RBAC-UI-002 | PASS_FULL | tenant-admin sites 仅 2 行本租户站点 |
| RBAC-UI-003 | PASS_FULL | foreign-admin sites 仅 1 行 foreign 站点 |
| OPS-P2-015 | PASS_FULL | `browser-checks.mjs` 公网 7/7（新镜像复验） |

本轮修复：① Gravatar 外部依赖（`admin.avatar: "default"`）；② `/api/users/me` 对
denied-read 角色 403（`readScope` users self-scope 例外）。详见 `my-deploy/mk-dev.md`「已修复」。

其余用例默认 `NOT_RUN`；标注"已有自动化"者可在执行时映射到对应 `*.test.ts` 快速转 `PASS_BACKEND`。

## P0 优先执行清单（建议首轮）

1. RBAC 全部 P0（越权/租户隔离是最高风险）。
2. COL 各集合 immutable + 唯一约束 + 强制钩子 P0。
3. INT 守卫横切 P0 + 幂等 P0（operations/rollback）。
4. DOM 状态机非法边 P0（内容/发布/操作/URL）。
5. SVC 幂等与发布/回滚数据安全 P0。
6. API 工作流/回滚端点 P0（补齐已验证的公开面之外部分）。

## 回写规则

- 只有 `PASS_FULL` 勾 `[x]`；纯后端契约用例 `PASS_BACKEND` 视同完成并注明"无 UI"。
- `FAILED`/`BLOCKED` 保持 `[ ]` 并在证据列引用 issue。
- 每轮更新"已完成"计数与本页"已验证"小节。
