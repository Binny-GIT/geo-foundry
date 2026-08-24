# 10 CMS 集合 CRUD / 字段 / 钩子（COL）

覆盖 `apps/cms/src/collections/*` 全部 14 个 Payload 集合。每集合按：CRUD 权限矩阵、字段校验、钩子、关系与唯一约束逐项拆分。权威来源：各集合文件 + `src/access/policy.ts`（RBAC 见 `11-cms-access-rbac.md`）。

## 集合 × CRUD 覆盖矩阵

`-` 表示该集合无此操作或被策略全局禁止；具体角色差异见 11 文档。

| 已测 | 集合 | slug | C | R | U | D | 关键约束 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] | Tenants | `tenants` | C | R | U | D | `name` 必填唯一，租户根 |
| [ ] | Users | `users` | C | R | U | D | auth+API Key，`role`/`tenant` 会话强制 |
| [ ] | Sites | `sites` | C | R | U | D | `tenant` 必填，canonical 配置 |
| [ ] | Domains | `domains` | C | R | U | D | `hostname` 唯一+规范化，站点租户一致 |
| [ ] | Contents | `contents` | C | R | U | D | `tenant` 强制 |
| [ ] | ContentEditions | `content-editions` | C | R | U | - | 多immutable列，媒体引用校验 |
| [ ] | Media | `media` | C | R | U | D | 上传，租户存储前缀隔离 |
| [ ] | UrlRecords | `url-records` | C | R | U | - | `pathname` 唯一，self-relation 跳转目标 |
| [ ] | QualityAssessments | `quality-assessments` | C | R | - | - | 证据immutable |
| [ ] | Operations | `operations` | C | R | U | - | `operationId` 唯一，阶段immutable |
| [ ] | Releases | `releases` | C | R | - | - | `releaseId` 唯一，全immutable |
| [ ] | RollbackIntents | `rollback-intents` | C | R | U | - | `intentId` 唯一，审批json |
| [ ] | IdempotencyRecords | `idempotency-records` | C | R | - | - | `key` 唯一，去重账本 |
| [ ] | OutboxEvents | `outbox-events` | C | R | U | - | `eventId` 唯一，派发状态immutable |

## Tenants

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-001 | P0 | super-admin 创建 tenant `name=Acme` | 创建成功、列表可见 | C 写入一行，id 生成 | NOT_RUN |
| [ ] | COL-P0-002 | P0 | 创建重名 tenant | 拒绝、唯一约束报错 | 无第二行写入 | NOT_RUN |
| [ ] | COL-P1-003 | P1 | `name` 留空创建 | 校验失败提示必填 | 无写入 | NOT_RUN |
| [ ] | COL-P1-004 | P1 | tenant-admin 读取本租户 tenant | 仅见自身租户 | R 结果被租户scope | 关联 RBAC |
| [ ] | COL-P1-005 | P1 | 重命名 tenant | 更新成功 | U 单行更新 | NOT_RUN |
| [ ] | COL-P2-006 | P2 | 删除被 site 引用的 tenant | 阻断或级联按策略 | D 行为与外键一致 | NOT_RUN |

## Users（auth + API Key）

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-010 | P0 | 后台账号密码登录 | 登录成功进入 Dashboard | 会话 cookie 建立 | 关联 API-* |
| [ ] | COL-P0-011 | P0 | 错误密码登录 | 拒绝并提示 | 无会话 | NOT_RUN |
| [ ] | COL-P0-012 | P0 | 非 super-admin 创建用户时篡改 `role` 提升为 super-admin | 被 `forceRoleFromSession` 纠正/拒绝 | 落库 role 非提升值 | 越权，关联 RBAC-P0 |
| [ ] | COL-P0-013 | P0 | 非 super-admin 创建用户时指定他租户 `tenant` | 被 `forceTenantFromSession` 覆盖为自身租户 | 落库 tenant=自身 | NOT_RUN |
| [ ] | COL-P0-014 | P0 | 生成/使用 API Key 调用 | 鉴权通过 | Key 关联用户与租户 | NOT_RUN |
| [ ] | COL-P1-015 | P1 | 用户仅可读写自身记录（self-scope access） | 越权读他人 403/空 | R scope 命中自身 | NOT_RUN |
| [ ] | COL-P1-016 | P1 | 无效 role 枚举值 | 校验拒绝 | 无写入 | NOT_RUN |
| [ ] | COL-P1-017 | P1 | super-admin 绑定 tenant（应禁止） | 拒绝 | 会话claims规则见 RBAC | NOT_RUN |

## Sites

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-020 | P0 | 创建 site 不带 tenant | 校验失败必填 | 无写入 | NOT_RUN |
| [ ] | COL-P0-021 | P0 | tenant-admin 创建本租户 site | 成功 | C tenant=自身、强制生效 | NOT_RUN |
| [ ] | COL-P1-022 | P1 | 配置 canonical 域/时区等 | 保存并回显 | U 字段持久化 | NOT_RUN |
| [ ] | COL-P1-023 | P1 | 跨租户读他人 site | 空/403 | R scope 隔离 | NOT_RUN |
| [ ] | COL-P2-024 | P2 | 非法时区值 | 拒绝（domain `validateTimezone`） | 无写入 | 关联 DOM |

## Domains

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-030 | P0 | 创建 domain，hostname 大写+尾点 | 保存为规范化小写无尾点 | `normalizeHostnameHook` 生效 | NOT_RUN |
| [ ] | COL-P0-031 | P0 | 重复 hostname | 唯一约束拒绝 | 无第二行 | NOT_RUN |
| [ ] | COL-P0-032 | P0 | domain.site 与 domain.tenant 不属同租户 | `ensureSiteTenantMatches` 拒绝 | 无写入 | 跨租户防护 |
| [ ] | COL-P1-033 | P1 | 绑定 domain 到本租户 site | 成功 | C 关系正确 | NOT_RUN |
| [ ] | COL-P2-034 | P2 | 非法 hostname（含空格/非法字符） | 规范化拒绝 | 无写入 | NOT_RUN |

## Contents

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | COL-P1-040 | P1 | 创建 content | 成功 | C tenant 强制 | PASS_FULL 260822（WebBridge 真实浏览器：editor 填 topic/intent → `POST /api/contents` 201，新文档租户强制 413、createdBy 默认 human） |
| [ ] | COL-P1-041 | P1 | 跨租户读 content | 隔离 | R scope | NOT_RUN |
| [ ] | COL-P1-042 | P1 | 更新 content | 成功 | U | NOT_RUN |

## ContentEditions

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-050 | P0 | 创建 edition 关联跨租户 content/site | `ensureTenantConsistency` 拒绝 | 无写入 | NOT_RUN |
| [ ] | COL-P0-051 | P0 | edition 引用不存在/跨租户 media | `ensureMediaReferences` 拒绝 | 无写入 | NOT_RUN |
| [ ] | COL-P0-052 | P0 | 直接改 immutable 列（如 workflowStatus 越过工作流） | access `update:()=>false` 拒绝 | 值不变 | 必须走工作流端点 |
| [ ] | COL-P1-053 | P1 | 合法创建 draft edition | 成功 | C 关系与租户一致 | NOT_RUN |
| [ ] | COL-P1-054 | P1 | 更新可变字段 | 成功 | U 仅可变列变化 | NOT_RUN |
| [ ] | COL-P2-055 | P2 | 删除 edition（应无 D） | 无删除入口/拒绝 | 无 D | NOT_RUN |

## Media（上传 + 租户前缀隔离）

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | COL-P0-060 | P0 | 上传媒体 | 成功、可预览 | 对象键含租户前缀 `forceTenantStoragePrefix` | PASS_FULL 260822（WebBridge 真实浏览器：editor 上传 1×1 PNG → `POST /api/media` 201，S3 对象 `geo-foundry/media/tenants/413/webbridge-verify.png`（rustfs-server 落盘核实），`GET /api/media/file/...?prefix=tenants/413` 200 可渲染，mediaPath=`/media/tenants/413/...`） |
| [ ] | COL-P0-061 | P0 | 租户 A 读取租户 B 媒体键 | 隔离/拒绝 | 存储前缀阻断 | 集成 media 测试已覆盖部分 |
| [ ] | COL-P1-062 | P1 | 非法 MIME/超限文件 | 拒绝并提示 | 无写入 | NOT_RUN |
| [ ] | COL-P1-063 | P1 | 删除媒体 | 成功、对象移除 | D DB+对象 | NOT_RUN |

## UrlRecords

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-070 | P0 | 同站点重复 pathname | 唯一约束拒绝 | 无第二行 | NOT_RUN |
| [ ] | COL-P0-071 | P0 | 保留路径 `/admin`、`/api` 作为 pathname | 拒绝（RESERVED_PATHNAMES） | 无写入 | 关联 SVC/DOM |
| [ ] | COL-P1-072 | P1 | 创建 reserved→active URL | 状态流转正确 | state 字段推进 | 走服务层 |
| [ ] | COL-P1-073 | P1 | 设置 redirectTarget 指向另一 url-record | 关系保存 | self-relation 正确 | NOT_RUN |
| [ ] | COL-P2-074 | P2 | 跨站点/跨租户 redirectTarget | 拒绝（图校验） | 关联 DOM url-graph | NOT_RUN |

## QualityAssessments

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-080 | P0 | 尝试更新已写入评估证据字段 | immutable 拒绝 | 值不变 | NOT_RUN |
| [ ] | COL-P1-081 | P1 | 记录评估（经服务层） | 生成一行、关联 edition/site/tenant | C 一致 | 关联 SVC/CPL |
| [ ] | COL-P1-082 | P1 | 跨租户读评估 | 隔离 | R scope | NOT_RUN |

## Operations

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-090 | P0 | 重复 operationId 提交 | 唯一约束/幂等命中 | 不新增行 | 关联 INT/SVC 幂等 |
| [ ] | COL-P0-091 | P0 | 篡改阶段/状态 immutable 列 | 拒绝 | 值不变 | NOT_RUN |
| [ ] | COL-P1-092 | P1 | 按 tenant/site 索引查询 | 命中索引、结果隔离 | R scope | NOT_RUN |

## Releases

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-100 | P0 | 任意更新 release（全 immutable） | 拒绝 | 值不变 | NOT_RUN |
| [ ] | COL-P0-101 | P0 | 重复 releaseId | 唯一拒绝 | 无第二行 | NOT_RUN |
| [ ] | COL-P1-102 | P1 | 记录 published release（服务层） | 生成 current 状态行 | manifestSha256/runtimeSiteId 正确 | 关联 SVC |

## RollbackIntents

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-110 | P0 | 重复 intentId | 唯一拒绝 | 无第二行 | NOT_RUN |
| [ ] | COL-P1-111 | P1 | 创建回滚意图（publisher） | 生成一行、approvedBy 记录 | C json 正确 | 关联 API/SVC |

## IdempotencyRecords

> 服务自有集合：`access` 全角色 `read/write=false`（`overrideAccess` 之外的 REST/GraphQL 面全拒）。
> Payload 3.88 对 read 被拒的集合，管理端列表页渲染 `not-found`（HTTP 404）且不进侧栏——**by design**，见 `renderListView`（`@payloadcms/next/dist/views/List/index.js`）。

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-120 | P0 | 同 key 二次写入 | 命中既有、不新增 | keyHash 一致、单行 | 关联 SVC |
| [ ] | COL-P1-121 | P1 | 跨租户 key 隔离 | 隔离 | tenant 索引 | NOT_RUN |
| [x] | COL-P1-122 | P1 | 管理端 `/admin/collections/idempotency-records` | 404、不在侧栏 | read 全拒 | PASS_FULL 260822（Playwright） |

## OutboxEvents

> 服务自有集合：`access` 全角色 `read/write=false`。管理端 404 + 侧栏隐藏 by design（同上）。

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | COL-P0-130 | P0 | 篡改派发状态 immutable 列 | 拒绝 | 值不变 | NOT_RUN |
| [ ] | COL-P1-131 | P1 | 业务写入触发 outbox 事件 | 生成 pending 事件 | eventId 唯一、payload 正确 | 关联 SVC outbox |
| [ ] | COL-P1-132 | P1 | 重复 eventId | 唯一拒绝 | 无第二行 | NOT_RUN |
| [x] | COL-P1-133 | P1 | 管理端 `/admin/collections/outbox-events` | 404、不在侧栏 | read 全拒 | PASS_FULL 260822（Playwright） |
