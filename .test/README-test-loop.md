# Geo Foundry 测试循环与规范

本目录是 geo-foundry 的人工/半自动测试需求库。约定沿用本机 nkmed、aixllent 项目的测试循环规范，做本项目裁剪。目标是**每个功能都有可追踪、可复现、颗粒度足够细的测试用例**。

## 目录结构

- `README-test-loop.md`（本文）— 状态词、优先级、ID、执行循环、证据字段。
- `requirements/00-scope-and-index.md` — 测试范围、模块索引、最近变更。
- `requirements/1x-*.md` — CMS（集合、权限、内部端点、公开端点、服务层）。
- `requirements/2x~9x-*.md` — domain、compiler、content-pipeline、content-client、worker、示例站点、部署运维、横切质量。
- `requirements/execution-matrix.md` — **权威状态账本**，聚合所有用例 ID 与最新状态。
- `accounts.md` — 测试账号（非机密标识）与凭据文件路径引用；口令/密钥只进安全文件。
- `browser-test-plan.md` + `browser-checks.mjs` — 公网浏览器可达性冒烟（已存在）。
- `artifacts/` — 截图、抓包等证据。

## 状态词（固定集合）

| 状态 | 含义 |
| --- | --- |
| `NOT_RUN` | 尚未执行 |
| `PASS_UI` | 界面/可见断言通过，后端未核验 |
| `PASS_BACKEND` | 后端/数据/契约断言通过，界面未核验 |
| `PASS_FULL` | 界面与后端断言全部通过 |
| `FAILED` | 存在缺陷，需登记 issue |
| `BLOCKED` | 依赖未就绪（环境、前置数据、上游缺陷）无法执行 |
| `SKIPPED_NA` | 该场景在当前形态不适用 |

规则：只有 `PASS_FULL` 才能把 `已测` 勾选为 `[x]`；其余状态一律保持 `[ ]`。纯后端/契约类用例（无 UI）以 `PASS_BACKEND` 视同完成，可勾 `[x]` 并在证据列注明 `无 UI`。

## 优先级

| 级别 | 定义（满足其一即归入） |
| --- | --- |
| P0 | 认证/RBAC/租户隔离、状态机合法性、幂等与去重、发布/回滚数据安全、审计不可变字段。缺陷直接阻断发布。 |
| P1 | 主流程业务操作、输入校验与错误码契约、编译/流水线正确性、内部 API 契约。 |
| P2 | 边界与回归、可访问性、响应式、性能与确定性、文档/工具链一致性。 |

缺陷严重级：阻断 / 高 / 中 / 低。

## 用例 ID

模式 `<AREA>-<PRIORITY>-<NNN>`，序号在各区域内稳定、不复用。区域码：

| 码 | 区域 |
| --- | --- |
| COL | CMS 集合 CRUD/钩子 |
| RBAC | 访问控制/会话/租户隔离 |
| INT | CMS 内部零信任端点 |
| API | CMS 公开端点/健康/后台/首页 |
| SVC | CMS 服务层 |
| DOM | domain 状态机/URL/不变量 |
| CMP | compiler 编译器 |
| CPL | content-pipeline 内容流水线 |
| CLI | content-client 契约客户端 |
| WRK | worker 队列/处理器 |
| CSVC | content-service 提交端 |
| SITE | 示例站点 site-a/site-b |
| OPS | 部署/运维/迁移/冒烟 |
| XC | 横切质量基线 |

示例：`RBAC-P0-003`、`INT-P1-021`、`DOM-P0-007`。

## 用例表格式

细粒度用例统一 7 列：

```
| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
```

- **场景/操作**：一句话描述触发条件（含角色、输入、前置）。
- **可见断言/期望**：界面可见结果或 HTTP 响应（状态码 + 关键字段）。
- **后端/数据断言**：DB 行/审计/幂等/状态迁移等，CRUD 用 `C/R/U/D` 前缀标注操作。
- **证据/备注**：状态词 + 日期 + 截图/抓包路径或备注，如 `PASS_FULL: 260822, artifacts/xxx.png`。

内部/公开 API 文档可改用 `端点 | 方法 | 场景 | 期望` 变体；集合可附 `页面 | 路由 | C | R | U | D` 覆盖矩阵。

## 执行循环（每轮）

1. 选定区域文档与本轮目标用例（优先 P0）。
2. 确认环境与前置数据（本地 dev / mk-dev 公网 / 集成栈）。
3. 按场景执行，同时抓取可见断言与后端断言。
4. 记录证据字段，回写状态词到该用例证据列。
5. 同步 `execution-matrix.md` 状态账本（矩阵是权威，明细文档是语义来源）。
6. 缺陷登记到 issue 并在证据列引用；`FAILED`/`BLOCKED` 保持 `[ ]`。
7. 清理测试数据（顺序：edition/URL/media → content/site/domain → tenant/user → 审计与 outbox 视需要保留）。

## 统一证据字段

每条用例执行后至少记录：环境、URL/端点、角色/身份、（UI）视口、步骤、可见断言、后端/数据断言、Console/Network、相关 ID、截图/抓包、状态词、日期、清理结果。

叙述式记录模板：

```markdown
### RBAC-P0-000 场景名称
已测：[ ] 状态：NOT_RUN
环境：本地/mk-dev；URL/端点：；身份：；视口：
步骤：
1.
可见断言：
后端/数据断言：
Console/Network：
相关 ID：
证据：
日期：
清理结果：
```

## 环境基线

- 本地 dev：`pnpm --filter @geo/cms dev`（安全包装器注入凭据）。
- 集成栈：`pnpm --filter @geo/cms test:integration`（共享 PG/Redis/RustFS，带锁与清理）。
- mk-dev 公网：`https://geo-foundry-mk-dev.aixllent.com`（Cloudflare 共享隧道 → 容器 `127.0.0.1:3090`）。单请求延迟 2-7 秒属隧道特征，超时给宽、失败重试；"慢"不是缺陷，"不可达"才是。
- UI 视口基线：375x812 / 768x1024 / 1280x720 / 1440x900。
- 内部端点身份基线：服务身份 `kind=service` 且 `role=content-service`；请求头 `x-request-id`（`[A-Za-z0-9._-]{8,64}`）、`x-operation-id`（`{4,128}`）。

## 发布门禁

- 所有 P0 用例为 `PASS_FULL`（或明确 `SKIPPED_NA` 并说明）。
- 无 `FAILED`（阻断/高severity）未关闭。
- `browser-checks.mjs` 公网冒烟 7/7 通过。
- 集成套件与 domain/compiler/pipeline 单测全绿。
