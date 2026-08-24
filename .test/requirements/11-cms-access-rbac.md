# 11 CMS 访问控制 / 会话 / 租户隔离（RBAC）

权威来源：`apps/cms/src/access/policy.ts`（`POLICY` 矩阵 + `decideAccess` + `readScope`）、`session.ts`（`resolveSessionClaims`）、`roles.ts`（6 角色）、`functions.ts`（`collectionAccess`/`scopedWrite`）、`tenant-*`/`role-*` 钩子。已有自动化：`test/unit/access-guards.test.ts`、`test/unit/access-policy.test.ts`、`test/integration/tenant-access.test.ts`。

角色：`content-service`、`editor`、`publisher`、`reviewer`、`super-admin`、`tenant-admin`。资源：`CMS_RESOURCE`（11 类）。动作：create/read/update/delete。

## 会话 claims 解析（session.ts）

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | RBAC-P0-001 | P0 | 无 user 解析 claims | deny-by-default | 返回拒绝/空 claims | 已有自动化 |
| [ ] | RBAC-P0-002 | P0 | 非 super-admin 且未绑定 tenant | 拒绝（必须租户绑定） | 抛错/拒绝 | 已有自动化 |
| [ ] | RBAC-P0-003 | P0 | super-admin 绑定了 tenant | 拒绝（不得绑定） | 抛错/拒绝 | 已有自动化 |
| [ ] | RBAC-P0-004 | P0 | 合法 tenant-admin | claims 冻结、含 tenantId | `Object.isFrozen` 为真 | NOT_RUN |
| [ ] | RBAC-P0-005 | P0 | 跨租户 claims 判定 `isCrossTenantClaims` | 仅 super-admin 为跨租户 | 布尔正确 | NOT_RUN |

## 策略矩阵（policy.ts）逐角色×资源×动作

以下每格是一条用例：验证 `decideAccess(role, resource, action)` 与集合实际行为一致。此处列出高风险组合，完整 66 组合以矩阵脚本对照 `POLICY` 逐一断言。

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | RBAC-P0-010 | P0 | editor 对 editions create/update | 允许 | 写入成功 | NOT_RUN |
| [ ] | RBAC-P0-011 | P0 | editor 对 releases create | 拒绝 | 无写入 | NOT_RUN |
| [ ] | RBAC-P0-012 | P0 | reviewer 对 editions 只读+审阅相关 | 读允许、越权写拒绝 | scope 命中 | NOT_RUN |
| [ ] | RBAC-P0-013 | P0 | publisher 对 releases/rollback create | 允许 | 写入成功 | 关联 API |
| [ ] | RBAC-P0-014 | P0 | publisher 对 users create | 拒绝 | 无写入 | NOT_RUN |
| [ ] | RBAC-P0-015 | P0 | tenant-admin 对本租户全资源管理 | 允许（限本租户） | scope=tenant | NOT_RUN |
| [ ] | RBAC-P0-016 | P0 | tenant-admin 跨租户任意资源 | 拒绝 | scope 阻断 | NOT_RUN |
| [ ] | RBAC-P0-017 | P0 | super-admin 全资源全动作 | 允许 | scope=true | NOT_RUN |
| [ ] | RBAC-P0-018 | P0 | content-service 仅内部所需资源 | 按矩阵允许/拒绝 | 与 policy 一致 | 关联 INT |
| [ ] | RBAC-P1-019 | P1 | 全 66 组合逐一对照 POLICY | 每组 decideAccess 与集合 access 一致 | 矩阵零偏差 | 建议脚本化 |

## readScope 数据可见域

> 2026-08-22 修复：`readScope` 对 `users` 资源增加 **self-scope 例外**——角色矩阵拒绝 users 列表读取时，
> 仍允许读取自己的 profile（`{ id: { equals: userId } }`）。管理端 UI 依赖 `GET /api/users/me`，
> 此前 editor/reviewer/publisher 等角色在后台页产生 403 console error（浏览器测试发现，镜像 `mk-dev-a6ae08e` 前复现）。

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | RBAC-P0-020 | P0 | super-admin readScope | 返回 true（全域） | 无 Where 限制 | PASS_BACKEND 260822（单测 15/15） |
| [x] | RBAC-P0-021 | P0 | tenants 资源 readScope | 限自身 tenant id | Where id=self | PASS_BACKEND 260822（tenant-admin 仅见 1 行） |
| [x] | RBAC-P0-022 | P0 | 普通资源 readScope | 限 tenant scope | Where tenant=self | PASS_BACKEND 260822（editor sites 仅本租户 2 行） |
| [x] | RBAC-P0-023 | P0 | 列表查询跨租户数据泄露探测 | 只返回本租户行 | 结果集零跨租户 | PASS_BACKEND 260822（editor/foreign-admin 双向验证） |
| [x] | RBAC-P1-024 | P1 | denied-read 角色 readScope(users) | `{ id: { equals: userId } }`（仅自己） | `/api/users/me` 200 | PASS_BACKEND 260822（单测 15/15） |

## 租户绑定与字段强制钩子

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | RBAC-P0-030 | P0 | 写入时篡改 tenant 字段 | `forceTenantFromSession` 覆盖为会话租户 | 落库=会话租户 | 多集合适用 |
| [ ] | RBAC-P0-031 | P0 | 写入时篡改 role 字段 | `forceRoleFromSession` 纠正 | 落库=会话角色 | Users |
| [ ] | RBAC-P0-032 | P0 | Media 存储前缀强制 | `forceTenantStoragePrefix` 生成租户前缀 | 对象键前缀正确 | 关联 COL-P0-060 |
| [ ] | RBAC-P0-033 | P0 | 角色提升赋值防护 `role-assignment` | 越权提升被拒 | 无提升写入 | 已有 access-guards |
| [ ] | RBAC-P1-034 | P1 | 审计 actor 记录 `audit-actor` | 写操作记录真实 actor | 审计字段正确 | NOT_RUN |

## 端到端权限流（UI + API）

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | RBAC-P0-040 | P0 | 未登录访问 `/admin` 受保护页 | 跳登录 | 无数据返回 | UI |
| [x] | RBAC-P0-041 | P0 | editor 登录后菜单/操作按权限收敛 | 越权入口不可见/禁用 | 后端二次校验拒绝 | PASS_FULL 260822（公网 WebBridge：editor 仅 9 集合；强制租户字段隐藏；super-admin 无 Site create 权限页显示准确文案） |
| [ ] | RBAC-P0-042 | P0 | 越权直呼 REST API（绕过 UI） | 403/空 | 后端 access 拒绝 | 抓包证据 |

### UI 级浏览器实测（mk-dev，`browser-admin-tests.mjs` Phase C）

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | RBAC-UI-001 | P1 | editor 登录 → `/admin/collections/users` | 仅 1 行=自己（self-scope，260822 修复后形态） | readScope users → id=self | PASS_FULL 260822（Playwright + WebBridge 真实浏览器复验：恰 1 行=embed-editor） |
| [x] | RBAC-UI-002 | P1 | tenant-admin 登录 → `/admin/collections/sites` | 仅 2 行本租户站点（Embed Site A/B），无 foreign | readScope → Where tenant=self | PASS_FULL 260822（Playwright；WebBridge 以 editor 角色复验租户 scope：恰 2 行本租户站点） |
| [x] | RBAC-UI-003 | P1 | foreign-admin 登录 → `/admin/collections/sites` | 仅 1 行 Embed Foreign，无本租户站点 | 反向隔离 | PASS_FULL 260822（Playwright） |
