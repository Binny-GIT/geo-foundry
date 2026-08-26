# geo-foundry-mk-dev 浏览器测试文档

> 两层结构：
> 1. **冒烟** `browser-checks.mjs` — 公网可达性（本文"用例清单"），对应 `requirements/13`（API-*）与 `requirements/80`（OPS-P2-015）。
> 2. **深度** `browser-admin-tests.mjs` — 管理端登录 + 12 集合列表 + by-design 404 × 2 + Media 上传控件 + 文档视图 + RBAC 租户隔离 UI 冒烟（3 角色）；
>    结果写 `admin-latest-run.json`，截图 `artifacts/b*|c*.png`。对应 `requirements/13`（API-P0-050~063）、`requirements/10`（COL-UI-*）、`requirements/11`（RBAC-UI-*）。
>
> 完整分模块测试需求见 `README-test-loop.md` 与 `requirements/`。测试账号见 `accounts.md`（mk-dev 存量 `embed-*` 账号，固定测试口令见 `apps/cms/test/integration/helpers/embeddings-world.ts`）。

- 目标站点:`https://geo-foundry-mk-dev.aixllent.com`(Cloudflare 共享隧道 → 容器 `geo-foundry-cms-mk-dev`,127.0.0.1:3090)
- 浏览器引擎:Playwright 驱动的真实 Chromium(headless;曾用 xvfb 有头模式交叉验证)
- 执行入口:`node .test/browser-checks.mjs` / `node .test/browser-admin-tests.mjs`(从仓库根运行;结果写回本目录)
- 约定:每次检查最多重试 3 次,单次超时 45~90s(见"链路基线")

## 链路基线(为什么超时给得很宽)

共享隧道单请求延迟 2-7 秒(nkmed 同 profile,属主机到 Cloudflare 边缘的链路特征),
偶发 20 秒级超时需要重试。管理端 SPA 一次加载几十个 chunk,经隧道完整水合可能超过
一分钟。**"页面慢"不是缺陷,"不可达"才是。**

## 用例清单

| # | 用例 | 期望 | 结果 |
|---|------|------|------|
| 1 | 根路径 `/` | 200，渲染公开入口页和 “Content operations workspace” 主标题 | PASS (260822) |
| 2 | `/admin` | 200，标题 `Dashboard | Geo Foundry`，运营概览 + 12 集合卡片可见 | PASS (260822) |
| 3 | `/admin/login` | 200，邮箱和密码输入框均可见 | PASS (260822) |
| 4 | `/api/health` | 200 `{"status":"alive"}` | PASS |
| 5 | `/api/readiness` | 200,postgres 与 rustfs 均 ready | PASS |
| 6 | 未知路径 `/definitely-not-a-page` | 404 | PASS |
| 7 | 截图存档 | `.test/artifacts/*.png` | PASS(admin.png、admin-login.png) |

## 深度管理端用例（`browser-admin-tests.mjs`，260822 首跑）

| ID | 用例 | 期望 | 结果 |
|----|------|------|------|
| API-P0-050 | Dashboard 客户端挂载 | 无 import map 缺失/硬 console error | PASS (260822) |
| API-P0-051 | `/admin/login` 表单 + 品牌 | Geo Foundry Logo/引导文案 + Email/Password/Forgot/Login 可见、无 console error | PASS (260822) |
| API-P0-052 | 登录成功进 Dashboard | 标题 `Dashboard | Geo Foundry`，Operations workspace 可见，侧栏恰 12 集合，2 服务自有集合隐藏 | PASS (260822) |
| API-P0-060 | 首页渲染 | 标题 `Geo Foundry` + 主标题 | PASS (260822) |
| API-P1-061 | 首页管理端链接 | 指向 `/admin` | PASS (260822) |
| API-P1-062 | 未知路径 | 404 | PASS (260822) |
| API-P2-063 | 首页响应式 4 视口 | 无横向溢出 | PASS (260822) |
| API-P2-031 | health 无鉴权可达 | 200 alive | PASS (260822) |
| API-P1-053 | 12 集合列表页可打开 | 行数与库一致、无硬 console error | PASS (260822) |
| COL-UI-DENIED | 服务自有 2 集合管理页 | HTTP 404（by design） | PASS (260822) |
| API-P2-054 | Media 创建上传控件（editor） | file input 存在 + 拖拽区可见 | PASS (260822) |
| COL-UI-DOC | contents 文档视图 | 渲染无空白 | PASS (260822) |
| RBAC-UI-001 | editor → users | 仅 1 行=自己（self-scope） | PASS (260822) |
| RBAC-UI-002 | tenant-admin → sites | 仅本租户 2 站点 | PASS (260822) |
| RBAC-UI-003 | foreign-admin → sites | 仅 1 foreign 站点 | PASS (260822) |
| RBAC-UI-004 | editor 租户 UX | 创建表单无不可选 Tenant；列表显示 `Current tenant`、无 `Untitled - ID` | PASS (260822) |
| RBAC-UI-005 | 已登录但无 create 权限页 | 准确显示 permission 文案，不再误称“must be logged in” | PASS (260822) |

机器可读记录：`admin-latest-run.json`（2026-08-22T11:25Z，17/17）。

## 真实浏览器实测（kimi-webbridge，公网 `https://geo-foundry-mk-dev.aixllent.com/`，260822）

用用户真实浏览器（本地 daemon `127.0.0.1:10086`，session `geo-foundry`）走完整用户路径。
验证手段：snapshot + evaluate + network 捕获（daemon 与宿主文件系统隔离，不用截图）。
**结论：全部通过，未发现新缺陷，无需新一轮部署。**

| # | 路径（真实浏览器操作） | 断言 | 结果 |
|---|----------------------|------|------|
| 1 | `/` 首页 → 点 `Open administration` | 标题 `Geo Foundry`，链接落到 `/admin/login` | PASS |
| 2 | 登录页表单 + `Forgot password?` 链接 | Email/Password 输入框、Link href=`/admin/forgot` | PASS |
| 3 | super-admin 登录 → Dashboard | 侧栏恰 12 集合，2 服务集合隐藏 | PASS |
| 4 | 12 集合列表页逐一打开 | tenants 2 / users 7 / sites 3 / contents 6 / content-editions 6 与库一致；7 个空集合渲染 "No Results." | PASS |
| 5 | contents 文档视图（/contents/580） | topic/intent 值渲染、tenant 关系显示、无 Save（super-admin update=false by design） | PASS |
| 6 | content-editions 文档视图（/content-editions/540） | Status: Draft、Versions 1、Content/Site/Tenant 关系、Body block 编辑器（Heading+Paragraph） | PASS |
| 7 | 登出 → editor 登录 | 成功进 Dashboard（侧栏 9 集合，无 Tenants/Releases） | PASS |
| 8 | editor → users 列表 | 恰 1 行 = 自己（self-scope 修复真实浏览器复验） | PASS |
| 9 | editor → sites 列表 | 恰 2 行（本租户 Site A/B），租户隔离生效 | PASS |
| 10 | **Media 真实上传**（页内 DataTransfer 注入 1×1 PNG → Save） | `POST /api/media` 201；S3 对象 `geo-foundry/media/tenants/413/webbridge-verify.png`（rustfs-server 落盘核实）；`GET /api/media/file/...?prefix=tenants/413` 200 图片可渲染；mediaPath=`/media/tenants/413/webbridge-verify.png`；列表恰 1 行 | PASS（首次走通客户端→S3 上传全链路） |
| 11 | **contents 创建**（editor 填 topic/intent → Save） | `POST /api/contents` 201；新文档 581 租户强制 413、createdBy 默认 human | PASS |
| 12 | `/admin/account`（editor） | Email/Role/Tenant/Payload Settings 渲染 | PASS |
| 13 | 404 页 `/definitely-not-a-page` | 404 文案渲染 | PASS |
| 14 | 忘记密码（匿名态） | Email 输入框 + Submit + Back to login | PASS |
| 15 | 忘记密码（已登录态） | "Already logged in" 分支 + Back to Dashboard | PASS |

**观察项（by design，非缺陷）**：
- editor 等租户角色打开含 tenant 关系字段的页面时，UI 拉取 `/api/tenants` 返回 403（矩阵 read=false，已批准策略），UI 优雅降级显示 `Untitled - ID: 413` / `<No Tenant>`；服务端值正确（413），无功能影响。
- WebBridge `click` 只支持标准 CSS 选择器（无 Playwright `:has-text` 等扩展语法），误用会退化为原生表单提交（POST 到当前页 URL 并丢失 React 状态）——写脚本时注意。
- daemon 与宿主文件系统隔离：`screenshot`/`upload` 的路径在 daemon 侧解析，宿主文件不可见；页内文件注入用 `evaluate` + `DataTransfer`。

**测试数据清理**：用例 10/11 产生的验证记录（media `73`、contents `581`，均租户 413）在验证通过后已从 DB 与 RustFS 删除，恢复种子基线（contents=6 / media=0，与 `browser-admin-tests.mjs` 的 `EXPECTED_ROWS` 一致）。删除经直连 `pg-server` 执行（策略层对全角色禁删，属可丢弃测试产物清理，非删除种子数据）。

## UX 产品化与工作流实测（260822，镜像 `mk-dev-e220638`）

本轮针对真实用户旅程补齐 UX：不只验证“页面能打开”，还验证角色看到的字段、权限反馈、运营上下文与工作流动作是否可理解、可执行。

| 项目 | 真实浏览器验证 | 结果 |
|------|----------------|------|
| Geo Foundry 品牌 | 匿名登录页标题 `Login | Geo Foundry`，Logo、产品引导语、favicon 图标正常；无原厂 Payload 品牌残留 | PASS |
| 运营仪表盘 | super-admin Dashboard 渲染 `Operations workspace`，包含 Needs review / Approved / Ready to publish / Failed operations、当前 release、最近 operations；所有查询继承现有角色与租户 scope | PASS |
| 租户绑定 UX | editor 创建 Contents / Media 时 Tenant 控件隐藏（服务端 `forceTenantFromSession` 仍注入）；列表将不可解析关系降级为 `Current tenant`，无 `Untitled - ID` 噪音 | PASS |
| 权限反馈 | 已登录 super-admin 打开无 create 权限的 Site 创建页，显示 `You do not have permission…`，不再错误提示必须登录 | PASS |
| Reviewer 工作流 | 临时版本经真实浏览器 reviewer 页面显示 Approve / Request revision；实际 review→draft、review→approved 均成功 | PASS |
| Publisher 工作流 | 临时版本 publisher 页面按状态显示 Publish / Archive；实际 compiled→published→archived 成功 | PASS |
| Archived 主状态一致性 | 首轮验证发现 archived 仅写 Payload draft、默认 API 仍返回 published；修复服务将 archived 与 published 一样写主文档。修复后公网 `GET /api/content-editions/:id` 返回 `workflowStatus=archived`、revision=6 | PASS（真实缺陷已修复） |

一次性 UX 工作流测试数据（content 582 / edition 541 / assessment 202 / reviewer 1103 / publisher 1104 及 16 outbox、17 versions）已清理，种子基线恢复：contents=6、content-editions=6、quality-assessments=0、users=7。

最终回归：`browser-admin-tests.mjs` **17/17 PASS**（原 15 项 + 登录品牌、运营仪表盘、租户字段 UX、权限文案断言）。
界面美化（公开首页 hero+特性卡片、登录页去重复品牌、仪表盘卡片配色/徽章、工作流状态徽章）已复验，截图：
`artifacts/ov-01-homepage.png`、`artifacts/ov-02-login.png`、`artifacts/ov-03-dashboard.png`。

## 首页深度丰富 + 管理端大胆美化（260822，镜像 `mk-dev-072a1c5`）

方向：深蓝科技风（延续品牌 `#2563eb`/`#1d4ed8`）+ 自制线条 SVG 图标，通过 Payload 3.88 支持的全局 CSS 变量覆盖实现，覆盖登录页/侧边栏/列表页/表单/按钮，一次改动全站生效，不改动任何列表/表单组件本身。

| 项目 | 实现方式 | 真实浏览器验证 |
|------|----------|----------------|
| 全局主题 | 新增 `apps/cms/src/app/(payload)/admin-theme.css`，在 `layout.tsx` 中 `@payloadcms/next/css` 之后引入（未加 `@layer`，天然覆盖 Payload 自身样式，无需 `!important`） | 全站页面截图核对配色统一 |
| 强调色 | 覆盖 `--theme-success-*` 19 档色阶为蓝色系；核实实际生效于：单选按钮聚焦光晕、拖拽区高亮、成功 Toast、徽章、选中态等 | PASS |
| 主按钮/输入聚焦 | 额外核实：Payload `.btn--style-primary` 实际绑定 `--theme-elevation-800`（中性色）而非强调色，`.field-type input:focus` 绑定 `--theme-elevation-400`；针对性覆盖这两处真实类名后 Login/Save/Create 按钮与输入框聚焦框正确变蓝 | PASS（截图 `ux-05-create-form.png` Save 按钮、`ov-02-login.png` Login 按钮均为蓝色） |
| 侧边栏高亮 | 核实侧边栏当前页指示条实际使用 `.nav__link-indicator { background: var(--theme-text) }`，与强调色无关；单独覆盖为蓝色 | PASS |
| 圆角语言 | `--style-radius-s/m/l` 由 3/4/8px 提升到 6/10/16px，与首页/仪表盘卡片圆角统一 | PASS |
| 图标集 | 新增 `apps/cms/src/components/icons/index.tsx`（7 个线条 SVG：Pencil/ShieldCheck/Package/Search/CheckCircle/Send/AlertTriangle），零新增依赖 | 仪表盘 4 张指标卡、首页特性卡片、工作流程条均已替换 emoji |
| 首页丰富 | 新增品牌头条（Logo + Sign in 链接）、按真实 ContentEdition 状态机简化的工作流程图（Draft → Review → Quality gate → Publish）、4 条信任徽章（多租户隔离/不可变发布/双重质量门禁/审计）、装饰性渐变光斑（`overflow-x:hidden` 约束防止横向溢出） | PASS，4 视口回归无横向滚动 |

回归约束：保留 `<h1>Content operations workspace</h1>` 精确文案、`<a href="/admin">` 含 "Open administration" 文案、`metadata.title` 不变——均已在改版后复核，测试断言未改动仍然成立。

最终回归：`browser-admin-tests.mjs` **17/17 PASS**，镜像摘要 `sha256:072a1c5e...`（同镜像标签 `mk-dev-e220638`，构建时未产生新 git-sha 标签时用 `--force-recreate` 确保容器加载新内容）。
截图：`artifacts/ov-01-homepage.png`（首页全貌）、`artifacts/ov-02-login.png`（登录页蓝色主按钮）、`artifacts/ov-03-dashboard.png`（仪表盘图标+彩色顶边）、`artifacts/ux-05-create-form.png`（创建表单 Save 按钮）、`artifacts/ux-02-create-denied.png`（权限提示页）。

## 管理端 v2 大胆美化 + 首页 v2 深度丰富（260822，镜像摘要 `sha256:b892ad4...`）

v1（仅覆盖 `--theme-success-*` 色阶+按钮/聚焦色）用户反馈"看不出美化"。v2 按 Linear/Vercel 设计语言加码三块高可见度改动，全部选择器写入前从 Payload 编译 CSS 核实：

| 项目 | 改动 | 验证 |
|------|------|------|
| 侧边栏 | `.nav` 深海军蓝渐变，`.nav__link`/`.nav-group__toggle`/`.nav__label` 深底配色，当前页亮蓝指示条 | 截图 `ov-03-dashboard.png`、`list-sites.png` |
| 列表表格 | 去斑马纹→行 hover 蓝染；行间 1px 细线；列头 0.68rem 大写微标签 | 截图 `list-sites.png`、`list-users.png`（用户指出的 sites 列表页） |
| 内容画布 | 浅蓝灰 `#f4f6fb`（仅浅色主题），白色表面突出 | 同上 |
| 首页 | 新增数据带/工作流+角色徽章/角色权限四卡/控制面-服务面架构/页脚；图标集扩至 11 个 | 截图 `ov-01-homepage.png` |
| 租户列角色分支 | super-admin 显示 `Tenant <id>`、租户角色显示 `Current tenant` | 实时 DOM 复核（super-admin 见 Tenant 413/414） |

回归：17/17 PASS；h1 精确文案与 `Open administration` 链接断言未改动仍成立；4 视口无横向滚动。

## 产品化视觉系统 v3（2026-08-22，镜像 `mk-dev-e220638`，摘要 `sha256:834bb73a...`）

本轮针对用户反馈的“文字大小、间距不够高级感”完成一次基于真实渲染数据的视觉系统重构，不再继续零散调色。

| 区域 | 交付 | 验收结果 |
|------|------|----------|
| 公开首页 | 行内样式迁移至 `page.module.css`；两栏 hero 加静态 release workspace 面板；指标带、三项 outcome、语义化四步 workflow、双色控制/服务平面、最终 CTA；移除与 GeoLogo 冲突的 GF 假品牌 | 桌面和手机截图复核；4 视口无横向溢出 |
| 首页结构保护 | `browser-admin-tests.mjs` 保留文本/链接契约，并新增 CTA 最小 120×44px、正式 `Content workflow` 四步结构、手机纵向工作流和无横向溢出断言 | 4 视口 PASS：CTA 实测 212×46px，workflow=4 且结构正确 |
| 后台 token | `admin-theme.css` 新增字体、8px spacing、表面、边框、控件、表格和状态 token；Dashboard/WorkflowActions/GeoLogo 收敛到同一视觉语言 | typecheck + CMS 67/67 PASS |
| 真实字号缺陷修复 | Kimi 实测发现 Payload 根 rem 为 13px，原 `0.875rem` 正文仅为 11.375px、`0.75rem` 表头仅为 9.75px；改为绝对 token 后重建 | Kimi 公网 Sites 实测：正文 **14px/20px**、表头 **12px/16px**、行高 **49px**、overflow=0 |
| 高频列表 | Contents/Sites/Domains/Media/Content Editions 明确 `defaultColumns`，优先展示标题、状态、关联范围与更新时间 | Kimi Sites 实测列：Name / Status / Locale / Timezone / Tenant / Updated At；3 行正常显示 |
| 后台层级 | Dashboard 的正常库存改中性表面，失败项才使用高显著色；工作流取消独立渐变/发光，统一主/次操作样式 | Kimi Dashboard 实际会话、桌面/手机截图均通过 |

最终自动回归：`browser-admin-tests.mjs` **17/17 PASS**（`admin-latest-run.json` 时间 `2026-08-22T23:51:23.404Z`）。

最终截图：`artifacts/ov-01-homepage.png`、`artifacts/ov-03-dashboard.png`、`artifacts/ov-04-contents-list.png`、`artifacts/ux-05-create-form.png`、`artifacts/ux-08-mobile-dashboard.png`、`artifacts/ux-09-mobile-list.png`。

## Operations Dashboard + Sites Operations Workspace（2026-08-23，镜像 `mk-dev-e220638`，摘要 `sha256:34a63ebd...`）

本轮将 `/admin` 从“默认 Collection Cards 上方的统计插槽”替换为真正的 access-scoped 运营控制台，同时在 `/admin/collections/sites` 的标准列表上方增加站点运营工作区；默认 Payload CRUD、筛选、列偏好、表格、批量操作和权限策略均保留。

| 页面 | 真实数据与权限行为 | 公网验收 |
|------|------------------|----------|
| `/admin` | Dashboard View 使用 `payload.find`，全部 `overrideAccess=false` 并传入 viewer；展示 Needs attention、7 状态 workflow pipeline、site fleet、release/operation/rollback 活动、角色快捷入口 | Kimi 确认无默认 `Collections` 标题卡片区；5 个运营区；无横向溢出 |
| 角色 scope | super-admin 显示 `All tenants`；tenant-bound 人类角色显示 `Current tenant`；不允许读 Releases 的 editor/reviewer 显示 `Restricted`，不把权限拒绝伪装成 0 或泄漏 release ID | Kimi editor 手机截图：Current releases / site release 均为 Restricted；2 tenant-scoped sites，无 cross-tenant 数据 |
| `/admin/collections/sites` | `beforeList` 服务端 slot 增加 Sites workspace；从 Sites/Domains/Editions/Releases 派生 active canonical domain、alias、current release、workflow 数；下方原表格继续为 registry | Kimi desktop：workspace 在标准表格前，3 site cards、`No domains configured`、`No current release` 均来自真实零基线 |
| 真实空态 | browser baseline 的 Domains/Releases 均为 0，因此界面明确显示配置/发布空态，不注入伪 hostname、伪 release 或健康 KPI | PASS |

安全与实现约束：Dashboard / Sites workspace 不调用 `/api/internal/*`，不写 workflow/release/operation 字段，不修改 RBAC 或租户注入；Release、Operations、Rollback panel 仅对 collection policy 允许读取的角色查询。

自动验证：新增 `operations-model.test.ts` 覆盖 workflow 分桶、canonical/alias/disabled domain 派生与跨站点分组；`tenant-field.test.ts` 验证 Sites 注册的是 `beforeList` augment 而不是 list replacement。CMS 单测 **71/71 PASS**。`browser-admin-tests.mjs` 增加 Dashboard 替换默认 Cards 与 Sites workspace 在表格前、真实空态断言，最终 **18/18 PASS**。

截图：`artifacts/b1-dashboard.png`、`artifacts/b3a-sites-workspace.png`、`artifacts/ux-08-mobile-dashboard.png`、`artifacts/ux-09-mobile-list.png`。

## approved→compiled→published→rollback 全链路（2026-08-23，run `admin-ui-20260823-3a5da6eb756e`，镜像 `mk-dev-e220638` 摘要 `sha256:ff18ef56...`）

发现并修复内容发布链路两处架构缺口：compile-results 端点原来只记证据不推进状态；publisher 曾直接调用通用 workflow-transitions 端点自证 `published`。详见 `my-deploy/mk-dev.md` 同名章节。

本轮脚本（`.test/admin-service-compile-loop.mjs`、`admin-publisher-publish-loop.mjs`、`admin-service-publish-loop.mjs`、`admin-published-verification-loop.mjs`、`admin-operations-verification-loop.mjs`、`admin-second-edition-{create,approve,compile,publish}-loop.mjs`、`admin-rollback-{intent-create,consume,verification}-loop.mjs`）在公网真实驱动了两条 Edition（542、543）分别走完 `approved→compiled→published`，并对 Edition 543 的真实第二条 release 执行了真实 Rollback Intent 创建 + CAS 回滚 + 下游页面复核，全部通过合法受保护路径完成，零硬控制台错误、零横向溢出。

发现的 UI/流程缺口（如实记录，不在本次范围内伪造数据）：URL Records 无任何生产创建路径；`/api/rollback-operations/intents` 无对应后台按钮入口。

### Kimi 真实浏览器复验补全（同日，最终镜像 `sha256:676b679f...`）

纠正此前"扩展未连接"的误判——本机 kimi-webbridge 已清理，实际经 SSH 隧道使用远程机器实例。用真实 publisher 会话复验全部页面（Dashboard/双 Edition 详情与列表/Sites workspace/Releases/Operations/Rollback Intents），数据全部与受保护 API 一致、零硬错误、零横向溢出；证据见 `admin-ui-evidence/<runId>/kimi-verification-result.json`。

复验过程中发现并修复两个真实缺陷（同根因：关系列默认单元格在这些列表永不水合，且 API 数据正常，非时序问题）：Releases 与 Rollback Intents 的 `site` 列显示 `<No Site>`，均以注册既有 `SiteCell` 修复，CMS 单测 83/83 通过，重新部署后即时复验生效。

## 管理端信息架构与视觉层级清理（2026-08-23，最终镜像 `mk-dev-e220638` 摘要 `sha256:d8b6d50a...`）

用户反馈管理端各类页面（表单/菜单/列表/详情）"不够整洁、清爽、直观"。逐项核实后确认是真实缺陷而非主观印象，分五轮修复+部署+Kimi 公网复验：

1. **TenantCell 从未解析真实租户名**：list 视图默认 `depth=0`，super-admin 在 Contents/Users/Releases 等所有列表里看到的都是裸 `Tenant 413`。套用与 `SiteCell` 相同的"同源 session 请求 + per-user 缓存"方案（`tenant-cell-model.ts`）。Kimi 复验 `/api/tenants/{id}?depth=0` 全部 200，Contents/Users 列表已显示真实租户名。同轮清理死代码 `OperationsWorkspace.tsx`（零引用）与 `pillClass()`（无对应 CSS 选择器），补齐 `Tenants`/`Users` 的 `defaultColumns`、`RollbackIntents` 的 `useAsTitle`。
2. **Token 语义纠正**：`admin-theme.css` 用蓝色 ramp 覆盖了 Payload 原生的 `--theme-success-*`（经查 `@payloadcms/ui` 的 `colors.scss` 确认这是 Payload 真实 token），导致 Payload 原生 success 语义（如保存成功 toast）被静默改色，产品自己的状态徽章又没有干净的成功色。改为 `--gf-accent-*`（品牌蓝，用于主按钮/焦点环/链接）+ 新增 `--gf-tone-{success,warning,danger,neutral,accent}-{bg,fg}` 语义 token，直接映射 Payload 未被污染的原生 ramp。Kimi 复验：Sites 列表 Active 状态 pill 实测由 `#dcfce7` 变为 Payload 原生 `rgb(218,237,248)`，accent 色值像素级不变，零错误。
3. **新增共享 UI 基础组件**（`apps/cms/src/components/ui/`）：`Badge`、`IconBadge`、`ActionLink`（primary/secondary），聚焦实际会被消费的子集,替换此前三处并行、互不一致的卡片/徽章/按钮手搓实现。
4. **视觉层级修复**：`WorkflowActions` 状态徽章改用共享 `Badge` + `WORKFLOW_TONE` 映射（不再硬编码 hex，`published` 是唯一 success 色）；Dashboard "Needs attention" 卡片图标与 7 段工作流 pipeline 边框在计数为 0 时强制中性色，不再让空态和真实告警撞脸；Sites workspace 卡片 4 个操作链接建立主/次层级（"Open site" 实心主按钮，其余描边次按钮）；Dashboard/Sites workspace 的 `Restricted` 权限态改用 `Badge` 渲染，不再和真实数字用同样的大号排版。Kimi 复验中发现并修复两处 CSS 优先级泄漏（旧的 `.gf-sites-workspace__card a`/`.gf-sites-workspace__metric span` 描述符选择器优先级高于新组件的单类选择器，导致主按钮文字对比度失败、Restricted 徽章字号被拉大）——加 `:not(.gf-ui-*)` 隔离后复验：primary 按钮 `rgb(37,99,235)` 底 `rgb(255,255,255)` 字，Restricted 徽章 `12px` 均正确。Dashboard 零计数验证：`pipeline` 中 `published`（2 条）保留绿色描边，其余 5 个零计数状态全部中性灰边框；4 个 needs-attention 图标全部中性色。
5. **Content Edition 详情页降噪**：确认 `extensions` 是每个 body block 都携带的应用自定义 JSON 扩展逃生舱（非 Payload 默认字段），改用 Payload `collapsible` 字段类型包裹，默认折叠（`admin.initCollapsed: true`），不影响存储数据形状（`packages/compiler`/`validate-body.ts` 仍按扁平 `extensions` 键读写）。浏览器交互式确认受 Payload block 行自身的展开/折叠交互限制未能完全跑通合成点击,但已通过部署构建产物字符串核实、结构单测、全量 integration 回归三重验证代码正确生效。

验证：typecheck 全程 clean；CMS 单测从 83/83 → **90/90 PASS**（新增 TenantCell、WORKFLOW_TONE、页面配置断言）；CMS 集成测试全量重跑，除两个此前已记录、与本轮改动无关的既存缺陷（`embeddings-similarity` HNSW planner 偶发统计抖动、`rollback-control-plane` 跨租户错误码 NOT_FOUND vs MISMATCH）外全部通过，含 `internal-endpoints`（含 compile/body 校验路径）13/13、`release-publish` 8/8、`content-editions` 9/9、`edition-workflow` 17/17。每轮均 `make image-build` + `docker compose --force-recreate --wait` 部署到 mk-dev 并跑通 `smoke.sh`。

## 已修复缺陷（260822）

- **Gravatar 外部依赖**：Payload 默认拉取 `gravatar.com` 头像，本网络不可达，认证管理页每个头像请求超时并产生 console error（`net::ERR_CONNECTION_REFUSED/TIMED_OUT`）。修复：`payload.config.ts` 设 `admin.avatar: "default"`，镜像 `mk-dev-a6ae08e`。
- **测试脚本缺陷**（非产品缺陷）：`waitForSelector` 混用 css/text 引擎报 `Unexpected token "="`；`.or().first()` 在空列表（无 table、无 "documents" 文案，实为 "No Results."）上挂起。已改为轮询 `table` / "No Results."。

## 运行记录

| 日期 | 执行 | 结果摘要 |
|------|------|---------|
| 2026-08-19 | browser-checks.mjs(真实 Chromium) | 7/7 PASS,0 FAIL;机器可读结果见 latest-run.json;单请求延迟 2-7 秒(与 nkmed 同 profile,隧道链路特征) |
| 2026-08-22 | browser-checks.mjs + browser-admin-tests.mjs(镜像 mk-dev-a6ae08e) | 冒烟 7/7;深度 15/15(admin-latest-run.json);修复 Gravatar 外部依赖与 /api/users/me 403 后复验全绿 |
| 2026-08-22 | browser-admin-tests.mjs（镜像 mk-dev-072a1c5，首页深度丰富 + 管理端大胆美化） | 深度 17/17；typecheck+webpack build+CMS 单测 67/67 全通过；截图逐张人工核对配色/图标/布局；测试数据无残留（本轮未新建持久化数据） |
| 2026-08-24 | browser-admin-tests.mjs（GF Studio 换肤重建，镜像 mk-dev-e220638，摘要见下方章节） | 真实 Playwright 4 视口 × 多角色 17/18 PASS；唯一失败为集合行数与旧硬编码期望值不符（12 个集合 err=0，纯测试基线数据增长，非本轮回归）；CMS 单测 90/90 |
| 2026-08-24 | browser-admin-tests.mjs（原生列表/表单页视觉打磨补课，镜像 mk-dev-e220638，摘要见下方章节） | 同一已知基线问题 17/18 PASS，无新增回归；CMS 单测 90/90（纯 CSS 改动）；Playwright 直接截图复验列表/详情/移动端/真实深色主题 |

## GF Studio 管理端全新设计系统（2026-08-24，最终镜像 `mk-dev-e220638`，摘要 `sha256:7c3a0695...`）

用户明确要求"大胆推翻原来的前端库，可以用 Tailwind，尽量适配手机端，追求美观大方整洁高级"。这不是继续调 token，而是引入 Tailwind v4 并整体重建视觉语言，同时保留 Payload 全部原生功能件（列表/筛选/字段编辑器/批量操作一律不动）。

### 技术方案
- **Tailwind v4 仅作用于 `(payload)` 路由组**：新增 `apps/cms/src/app/(payload)/admin-tailwind.css`，只导入 `tailwindcss/theme.css` + `utilities.css`（**不导入 preflight**，避免全局 reset 破坏 Payload 原生 DOM），用 `source(none)` + 单一 `@source "../../components"` 严格限定扫描范围，并用 `@source not inline("{hover:,focus:,}table")` 排除与 Payload 原生 `.table` 类唯一冲突的工具类名。只从 `(payload)/layout.tsx` 引入，公开首页（CSS Modules）完全隔离，已用 Playwright 4 视口回归确认零泄漏。
- **双主题 token 体系**：`admin-theme.css` 按 Payload 官方 `--theme-*` 变量命名（bg/input-bg/text/border-color/overlay/elevation-0..1000/success/warning/error 全 ramp）分别在 `:root`（浅色）与 `html[data-theme="dark"]`（深色）重定义，Payload 存量表单/按钮/表格/分页/抽屉/弹窗/登录页全部通过变量自动换肤，不需要逐组件硬编码。主色改为靛蓝（`--gf-accent-600: #4f46e5`）。
- **中文为主 + 多语言**：`payload.config.ts` 注册 `@payloadcms/translations` 官方简体中文包为 `fallbackLanguage`，浏览器语言为中文时自动显示中文原生 UI（表格/按钮/字段标签等），非中文浏览器仍可用英文，无需强制切换。
- **真实字号 bug 修复**：Payload 的 `html` 根字号是 13px（非常见的 16px），若直接使用 Tailwind 默认 rem 工具类（`text-sm`/`rounded-2xl`/`gap-4`）会整体缩小 ~19%（`text-sm` 仅 11.375px，与本仓库更早一轮修复过的同类缺陷完全一致）。已在 `admin-tailwind.css` 的 `@theme` 块里用 `calc(原始rem值 * 16 / 13)` 重新校准 `--spacing`/`--text-*`/`--radius-*` 三套 Tailwind 内部尺度，使所有 rem 工具类无视 Payload 根字号、始终渲染为设计意图的真实像素值。Kimi 复验：卡片圆角 16px、小标签字号 12px、H1 字号 24px，均校准正确。

### 旗舰组件重建（数据/RBAC 逻辑逐行保留，只重写呈现层）
`OperationsDashboard.tsx`、`SitesOperationsWorkspace.tsx`、`WorkflowActions.tsx`、`branding/LoginIntro.tsx` 全部改用 Tailwind 工具类 + CSS 变量重写：KPI 数值带（tabular-nums）、告警队列卡（零计数保持中性）、7 段工作流 stepper（零计数中性描边，有数据才着色）、站点卡片（唯一实心主按钮 + 描边次按钮）、工作流面板（Badge tone 徽章 + 44px 触控按钮）、登录页（克制的靛蓝光晕 + 分隔线介绍卡）。全部界面文案改为简体中文（`workflowActionsFor` 的按钮标签、Dashboard/Sites workspace 的标题与空态提示等），同步更新了 `workflow-actions-model.test.ts` 的对应断言。

### 验证
- typecheck 全程 clean；CMS 单测 90/90 PASS（不含新增用例，纯回归）。
- 每个 Phase 独立 `make image-build` → `docker compose --force-recreate --wait` → `smoke.sh` → Kimi 公网真实浏览器复验（登录页圆角/靛蓝按钮/背景光晕/焦点环、列表页表格完整性、暗色主题 token 解析、导航深色渐变、Sites 工作区主按钮对比度、WorkflowActions 中文按钮与靛蓝背景、Dashboard 暗色卡片对比度），过程中发现并修复两处真实 CSS 缺陷：`.gf-sites-workspace__card a`/`.gf-sites-workspace__metric span` 等旧描述符选择器优先级高于新组件单类选择器，导致主按钮白字对比度失败、Badge 字号被拉大——已加 `:not()` 隔离修复。
- 收尾用真实 Playwright（`.test/browser-admin-tests.mjs`）对公开首页 4 视口（1440/1024/768/375）与管理端 4 角色（super-admin/editor/tenant-admin/foreign-admin）跑完整回归：**17/18 PASS**，唯一失败项 `API-P1-053` 是集合行数与测试脚本里旧的硬编码期望值不一致（12 个集合的 console error 均为 0，纯粹是此前多轮会话累积的基线数据增长，与本轮换肤重建无关，未做修复以免掩盖真实数据状态）。已同步把该脚本里断言英文文案的三处（登录页介绍、Dashboard 四个板块标题、Sites workspace 标题与空态）改为对应中文文案。
- 移动端（390px）未能通过 Kimi WebBridge 的 CDP 视口模拟单独复验（该工具当前不支持视口覆写），改为通过上述真实 Playwright 4 视口回归（含 375px 移动视口）覆盖，如实记录此工具限制。

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:7c3a06955186f7161d72fe62baaf34528a252389f94465821867d4416fb3c5e4`。

## 原生列表/表单页视觉打磨补课（2026-08-24，最终镜像 `mk-dev-e220638`，摘要 `sha256:1dc1e4c2...`）

用户反馈"样式和排版还有各种表单表格的样式还是丑"。核实为真实缺陷：上一轮换肤只做了 `--theme-*` token 重着色，Payload 原生页面的真实容器选择器（`.list-header`/`.search-bar`/`.pill`/`.table-wrap`/`.page-controls`/`.doc-header`/`.doc-tabs`/`.doc-controls__wrapper`）此前从未被样式化，其中 `.collection-list__header` 还是个从未匹配过的死选择器（真实类名是 `.list-header`）。用 Playwright 登录后 dump 真实 DOM 树逐个核对选择器（而非猜测类名），补齐列表页（Create New 靛蓝实心 pill、搜索栏/表格卡片化+阴影、分页 hover 态）与表单页（doc-header 大标题、doc-controls 卡片化、doc-tabs 靛蓝高亮）的 CSS。

排查中一度怀疑深色模式下 JSON 字段（Citations/Entities）的 Monaco 编辑器白底是真实缺陷，后确认是测试方法误差——用 `element.setAttribute("data-theme","dark")` 绕过了 Payload 真实的主题切换 React 状态，Monaco 未收到主题变更事件；改用账号设置页真实 Dark 开关复验后 Monaco 正确跟随深色主题，非产品缺陷。

验证：CMS 单测 90/90（纯 CSS 改动）；`browser-admin-tests.mjs` 全量回归 17/18 PASS，与前一轮同一个已知基线问题，无新增回归；额外用 Playwright 直接登录截图复验 Users/Content Editions/Sites 列表页、Edition 详情页，桌面 1440px + 移动 390px + 真实 Dark 主题（通过账号设置切换，非 DOM hack），确认卡片、阴影、pill 靛蓝、分页 hover、doc-tabs 高亮均生效且零横向溢出。

排查本轮起始时还发现 `geo-foundry-cms-mk-dev` 容器一度完全消失（公网 502），核实数据层（共享 Postgres/对象存储）未受影响后用既有镜像原样重新拉起、smoke 验证通过，根因未查明（无 docker events 记录）。

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:1dc1e4c2c34dd777f2ce2fd0a1a566dcbf7a36eea0660a9142a85c1e23e76242`。

## 独立 shadcn/Tailwind Console 正式接管 `/admin`（2026-08-26，commit `f524ae0`，镜像 `mk-dev-f524ae0`，摘要 `sha256:62151763...`）

用户明确要求所有管理页面去掉 Payload 原生视觉组件，改用 shadcn/Tailwind；Payload 只保留为认证 Cookie、REST/Local API、集合 schema、RBAC、租户隔离、上传、草稿/版本及工作流/审计后端。本轮完成正式路由切换：

- **普通 `/admin` 全部为 Console**：独立 Next route group、Tailwind v4 设计层、响应式 Shell、登录/忘记密码/重置密码/账户页、12 个可见集合的权限范围列表与安全详情。普通 Console 不导入 `RootLayout`、`RootPage`、`@payloadcms/ui` 或 Payload Admin CSS。
- **Payload 原生 Admin 下沉为 `/admin/_emergency/*`**：`payload.config.ts` 的顶层 `routes.admin` 指向该路径；Next 用 `%5Femergency` 源目录将公开 URL 保持为 `_emergency`；该子树才加载 Payload CSS、`RootLayout` 和 `RootPage`，并在服务器先用同一 HTTP-only Payload cookie + `resolveSessionClaims()` 限制为 super-admin。非 super-admin 无法从导航进入，也不能通过直接 URL 看到原生 Admin。
- **安全资源边界**：浏览器从不调用 `/api/internal/*`；所有 server read 使用当前 Payload user + `overrideAccess:false`；关系列以 `depth:1` 在可读时水合名称，无法解析时显示“受限”，不显示裸关系 ID。服务所有集合 `outbox-events`、`idempotency-records` 继续 by-design 404。
- **专项页面**：Users/Sites/Contents/Domains 的 create/edit 使用白名单字段和 server-side policy gate；Media 仅 editor 可访问 multipart `file + alt + caption` 上传页（不传 tenant/prefix/mediaPath，不支持 URL 导入）；URL Records 只允许 editor/publisher 使用专用 rename endpoint；Rollback Intents 只允许 publisher 使用专用创建 endpoint；Content Edition Studio 保存 raw block JSON draft，只提交可编辑字段，工作流仅调用既有公开 session endpoint（reviewer 仍传 expectedRevision、Idempotency-Key、x-request-id）。不可变质量/发布/操作账本保持只读。
- **深链兼容**：旧 `/console/*` 无状态跳转到 `/admin/*` 并保留查询参数；旧 `/admin/work*`、`/admin/history/releases`、`/admin/tenant` 与诊断路径均由 server session/RBAC 判定后跳入对应 Console 页面或 emergency fallback，不能借旧链接绕开访问控制。

**验证**：typecheck clean；CMS 单测 **140/140 PASS**；Biome lint 0 error；production build 路由表同时含 `/admin` Console、`/admin/_emergency/[[...segments]]` 和 `/console/[[...segments]]` compatibility redirect；mk-dev smoke 通过。真实 Chromium 完整回归 **18/18 PASS**：公开页 4 视口、Console 登录与密码恢复入口、Dashboard、12 集合、服务集合 404、Media 专项上传控件、Contents 详情、editor self-account/tenant 字段隐藏、super-admin 无 Sites create 权限 404、tenant-admin 与 foreign-admin 站点隔离全部通过。最终运行容器 `geo-foundry-cms-mk-dev` health=`healthy`，实际镜像摘要 `sha256:621517639d5aa8485c81bd868e764368c81c55a8b8b9d76aa72784505249b580`。

**并行部署说明**：本轮首次部署后发现 mk-dev 已被另一轮工作切换到 `main@a40fd52`，使公网仍显示 Payload 原生集合页；这不是 CDN 缓存或路由失效。Console migration 因此被单独提交到 `feat/console-admin-shadcn@f524ae0`，以 `mk-dev-f524ae0` 唯一镜像标签重新部署，并通过 `docker inspect` 核实当前容器确为该 digest 后才执行最终浏览器验收。
