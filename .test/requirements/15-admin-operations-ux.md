# 15 管理端运营 UX（UX）

覆盖 `docs/ux/admin-operations-ux-spec.md` 所定义的登录、运营指挥台、站点工作区、内容版本动作、按权限范围的数据呈现、响应式与可访问性。实现依据：`apps/cms/src/components/{dashboard,sites,workflow,branding}/`；既有浏览器基线见 `../browser-test-plan.md`。本区只验证体验与现有契约的可理解呈现，不替代 COL/RBAC/API/SVC/DOM 的后端安全与状态机用例。

## 登录与身份进入

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | UX-P0-001 | P0 | 匿名访问 `/admin` | 路由至登录；显示 Geo Foundry、内容运营中心、Email/Password/Forgot password | 不返回受保护运营数据；无第三方头像请求失败 | NOT_RUN |
| [ ] | UX-P1-002 | P1 | 人类角色登录成功 | 进入“运营指挥台”；展示对应范围与主操作 | 会话建立，查询以当前 user + `overrideAccess=false` 执行 | NOT_RUN |
| [ ] | UX-P0-003 | P0 | `content-service` 访问后台 | 显示不可使用人工控制台及内部集成接口说明 | 不查询或泄漏人类运营数据 | NOT_RUN |
| [ ] | UX-P2-004 | P2 | 中文/英文浏览器访问登录与核心后台 | 中文优先；非中文可回退英文；业务状态含义不失真 | 无语言切换导致的权限/数据差异 | NOT_RUN |

## 运营指挥台 `/admin`

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | UX-P0-010 | P0 | super-admin 打开 Dashboard | 显示“全部租户”、概览、待处理、7 状态工作流、站点就绪度/工作负载 | 仅读取其可见范围；不显示默认 Collections 卡片区 | NOT_RUN |
| [ ] | UX-P0-011 | P0 | tenant-bound 人类角色打开 Dashboard | 显示“当前租户”，不出现跨租户记录或计数 | 所有派生查询服从 tenant scope | NOT_RUN |
| [ ] | UX-P1-012 | P1 | editor/reviewer/publisher 打开 Dashboard | 主操作分别指向创建内容/审核队列/待发布队列；不显示无权动作 | 角色决定可见 action 和可读 ledger | NOT_RUN |
| [ ] | UX-P0-013 | P0 | 无 Releases 读取权限的角色 | 当前发布版本显示“受限”，而不是 0、release ID 或可访问链接 | 不请求/返回不可读 release 数据 | NOT_RUN |
| [ ] | UX-P1-014 | P1 | 待处理事项有数据和零数据各一组 | 风险项按影响显示、可进入对应登记页；空项不伪装成风险 | 回滚/失败操作/质量/域名/审核/待发布均来自可读记录 | NOT_RUN |
| [ ] | UX-P1-015 | P1 | 点击 7 状态工作流节点 | 打开带 `workflowStatus` 条件的 Content Editions 列表；数量与页面一致 | `draft/generating/review/approved/compiled/published/archived` 计数正确 | NOT_RUN |
| [ ] | UX-P2-016 | P2 | 配置就绪度与操作健康度 | 明确“代理指标/记录快照”而非 uptime 或成功率；状态文字+颜色可区分 | ready/publish/configure/disabled/restricted 与操作状态派生正确 | NOT_RUN |

## Sites workspace `/admin/collections/sites`

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | UX-P0-020 | P0 | 打开 Sites 列表 | “站点工作区”在原生登记表前；原列表搜索、筛选、列偏好、批量操作仍可用 | 工作区只读派生，不写 Site/Domain/Edition/Release | NOT_RUN |
| [ ] | UX-P1-021 | P1 | 有站点、主域名、别名、版本的租户 | 站点卡正确显示状态、主域名/别名、当前 release、工作量与更新时间 | 派生自可读 Sites/Domains/Editions/Releases，关联关系正确 | NOT_RUN |
| [ ] | UX-P0-022 | P0 | editor/reviewer 等无 release 权限访问 Sites workspace | 当前发布版本卡和站点 release 字段显示“受限” | 不泄漏 release 数量、ID、历史或跳转链接 | NOT_RUN |
| [ ] | UX-P1-023 | P1 | 无站点、无主域名、主域名停用、无当前 release | 各真实空/风险态有明确文案，无假 hostname/release | 数据为零或相应真实状态，不能由 UI 造数 | NOT_RUN |
| [ ] | UX-P1-024 | P1 | tenant-admin 与非编辑角色查看站点卡操作 | “打开站点”为唯一主操作；域名/版本/发布历史为次级；编辑配置仅合规角色出现 | 链接目标与 collection access 一致 | NOT_RUN |

## 内容版本工作流与反馈

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | UX-P0-030 | P0 | editor 在 draft/generating/published 版本详情 | 分别只见开始生成；提交审核/退回草稿；创建新草稿 | 仅调用既有会话端点；非法角色/状态无 action | NOT_RUN |
| [ ] | UX-P0-031 | P0 | reviewer 在 review 版本详情 | 显示批准版本与退回修改；退回原因必填；成功后刷新状态 | 仅审核专用端点；服务端复核 reviewer 身份、tenant、expected revision 和 Idempotency-Key；未知与跨租户版本返回同一 404 | NOT_RUN |
| [ ] | UX-P0-032 | P0 | publisher 在 compiled/published 版本详情 | compiled 显示发布版本，提交后提示后台处理；published 显示归档版本 | 发布请求不被 UI 误报为完成；归档后主文档状态为 archived | NOT_RUN |
| [ ] | UX-P1-033 | P1 | 质量未通过、未编译、角色不足、陈旧 revision | 出现对应可理解反馈；失败不清空当前表单/不改变显示状态 | 映射既有端点错误，状态无越权/越级写入 | NOT_RUN |
| [ ] | UX-P1-034 | P1 | 工作流操作进行中或重复点击 | 当前按钮显示处理中且禁用重复提交，结束后恢复/刷新 | 单次请求；幂等与乐观并发仍由服务端保证 | NOT_RUN |

## 租户、权限、可访问性与响应式

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | UX-P0-040 | P0 | tenant-bound editor 创建 Contents/Media、查看关系列 | Tenant 输入不供篡改；不可读关系显示“当前租户”或安全降级，无 `Untitled - ID` | `forceTenantFromSession` 强制落库为会话租户 | NOT_RUN |
| [ ] | UX-P0-041 | P0 | 已登录但无 create/read 权限访问相关页或直达 URL | 准确说明缺少权限；服务自有集合不在侧栏且为 by-design 404 | UI 隐藏之外，后端仍拒绝越权请求 | NOT_RUN |
| [ ] | UX-P2-042 | P2 | 登录、Dashboard、Sites、Edition 详情、创建表单在 375/768/1280/1440 | 无横向溢出，文字/状态/主操作可读可点 | 不因窄屏触发重复请求或 scope 差异 | NOT_RUN |
| [ ] | UX-P2-043 | P2 | 关键页键盘和 axe 检查 | 焦点可见；链接/按钮/区块具备可访问名称；无严重 axe 违规 | — | NOT_RUN |
| [ ] | UX-P2-044 | P2 | 关键用户路径（登录、Dashboard、Sites、Edition、Media） | 无空白页和 hard console error；网络/空态反馈明确 | 无 client error 掩盖实际 API 失败 | NOT_RUN |

## 执行说明

- UI 写入验收使用隔离 fixture，依赖顺序与精确清理见 `../admin-ui-loop-runbook.md`；浏览器不得调用 `/api/internal/*`。
- `UX-P0-*` 与 RBAC/API/DOM/SVC 的相同后端断言应交叉引用，不以 UI 通过替代后端安全验证。
- 当前基线的历史浏览器证据位于 `../browser-test-plan.md`；本文件的状态以 `execution-matrix.md` 为准。
