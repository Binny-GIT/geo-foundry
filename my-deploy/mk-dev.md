# Geo Foundry CMS — mk-dev 部署运行手册

人类可读运行手册。权威基础设施事实见知识库 Operations/Infrastructure 文档；
凭据不落仓库，保存在 `/opt/geo-foundry/mk-dev.env`（root:root 600）。
测试账号（角色邮箱、凭据文件路径）见 `.test/accounts.md`。

## 拓扑

- 容器：`geo-foundry-cms-mk-dev`，镜像 `geo-foundry-cms:mk-dev-<git-sha>`，
  端口 `127.0.0.1:3090->3090`，非 root（uid 1001），restart `unless-stopped`。
- 公网入口：`https://geo-foundry-mk-dev.aixllent.com`（共享隧道 `opencode-mk-dev`）。
- 共享服务（本项目不新增基础设施容器）：
  - PostgreSQL：`pg_default` 网络别名 `pg-server:5432`（数据库/Schema `geo_foundry`）
  - RustFS：`rustfs-shared` 网络别名 `rustfs-server:9000`（prefix `geo-foundry/objects/`）
- 健康检查：容器内 `/api/health`（30s）；就绪（PG+RustFS）`/api/readiness`。
- 监控：Watchtower Target「Geo Foundry mk-dev」，每分钟 GET 公网 `/api/health`。

## 一次性准备（已完成）

```sh
docker network create rustfs-shared
docker network connect rustfs-shared rustfs-server
sudo install -d -m 700 /opt/geo-foundry
# 编辑 /opt/geo-foundry/mk-dev.env：IMAGE_TAG / COMPOSE_ENV / GEO_FOUNDRY_PG_* /
# GEO_FOUNDRY_S3_*（ENDPOINT=rustfs-server）/ PAYLOAD_SECRET，权限 root:root 600
```

## 语义命令（仓库根 Makefile）

```sh
make image-build        # 宿主机构建 + 打包镜像（容器内无法访问 npm registry）
make container-smoke    # verify 栈起容器 + 本机健康冒烟 + 清理
make deploy-mk-dev      # mk-dev 栈 up --wait + 本机/公网 smoke
make rollback-mk-dev    # 改 /opt/geo-foundry/mk-dev.env 的 IMAGE_TAG 后重跑
```

底层等价命令：

```sh
docker compose --env-file /opt/geo-foundry/mk-dev.env \
  -f deploy/compose.yaml -f deploy/compose.mk-dev.yaml up -d --no-build --wait
```

## 数据库迁移

mk-dev 迁移仍在宿主机执行（expand-only；容器只负责服务）：

```sh
/home/ubuntu/.local/bin/geo-foundry-cms-secure pnpm --filter @geo/cms db:migrate
```

迁移后无需重启容器（连接池自动感知）。破坏性 contract 迁移须等回滚窗口关闭。

## 已知问题

- 共享隧道单请求延迟 1-3s 属主机链路特征（nkmed 相同），非本项目问题。

## 已修复（2026-08-22）

- `/admin` 空白页：根因为 Payload import map 生成路径错位（生成器默认写 `importMap.js`，
  应用导入 `app/(payload)/admin/importMap.ts`，导致 `S3ClientUploadHandler` 缺失、
  客户端视图不挂载）。修复：`admin.importMap.importMapFile` 指向应用实际导入文件 +
  build 脚本前置 `payload generate:importmap` + 生产构建改用 `next build --webpack`。
  证据：`.omo/evidence/260819-cms-admin-blank/`。
- 管理端页面 console error（`net::ERR_CONNECTION_REFUSED/TIMED_OUT`）：根因为 Payload
  默认拉取外部 Gravatar 头像，本网络不可达。修复：`payload.config.ts` 设
  `admin.avatar: "default"`（镜像 `mk-dev-a6ae08e` 起生效）。
- `GET /api/users/me` 对 denied-read 角色（editor 等）403：`readScope` 对 `users` 资源增加
  self-scope 例外（仅自己一行），管理端 UI 依赖该端点。单测 15/15 通过（镜像 `mk-dev-a6ae08e` 重建后生效）。

## 真实浏览器全功能验收（kimi-webbridge，2026-08-22，镜像 `mk-dev-a6ae08e`）

用用户真实浏览器走公网 `https://geo-foundry-mk-dev.aixllent.com/` 完整用户路径，15/15 通过，
**未发现新缺陷，无需再部署**。覆盖：首页、登录/登出、Dashboard、12 集合列表（行数与库一致）、
contents/content-editions 文档视图、**Media 真实上传**（客户端→S3 全链路，对象
`geo-foundry/media/tenants/413/webbridge-verify.png`）、**contents 创建**（租户强制）、
editor RBAC（users 自见 1 行、sites 租户 scope 2 行）、account 页、404 页、忘记密码（匿名/已登录两态）。
记录见 `.test/browser-test-plan.md`「真实浏览器实测」节。

- 观察项（by design 非缺陷）：租户角色页面拉取 `/api/tenants` 得 403（矩阵 read=false）。
  260822 UX 版本已将服务端强制绑定的 Tenant 表单控件对租户角色隐藏，列表关系降级为
  `Current tenant`，不再向用户暴露 `Untitled - ID: <id>`。

## UX 产品化与工作流交付（2026-08-22，镜像 `mk-dev-e220638`）

- 管理端品牌化：Geo Foundry Logo/Icon、`Login | Geo Foundry` / `Dashboard | Geo Foundry` 标题、登录引导语。
- Dashboard 增加 access-scoped `Operations workspace`：待审/已批准/待发布/失败操作计数、当前发布、最近操作；
  通过 Payload Local API `overrideAccess=false` 查询，绝不绕开租户/RBAC。
- editor 等租户角色的 Tenant 关系字段按 `admin.condition` 隐藏，服务端 `forceTenantFromSession` 继续强制绑定；
  列表改为 `Current tenant`，消除无权限解析关系时的 `Untitled - ID`。
- 无 create 权限页的 i18n 文案改为准确权限提示，不再错误提示用户必须登录。
- content-editions 详情页增加角色/状态驱动的工作流按钮：reviewer 的 Approve / Request revision、publisher 的 Publish / Archive、editor 的 Create next draft；全部调用已有 session-auth workflow endpoint，不直接写 service-owned 字段。
- 浏览器验收发现 `published → archived` 只写 Payload draft、默认 API 仍返回 published 的真实缺陷。
  已修复 `edition-workflow.ts`：archived 与 published 都写入 live document；公网 API 已复验返回 `archived`。
- 验收：CMS 单测 67/67，生产 webpack build 通过，smoke 通过，公网扩展浏览器回归 17/17 PASS；
  reviewer/publisher 全工作流真实浏览器验证后，临时数据全部清理并恢复种子基线。
- 界面美化：公开首页升级为 hero + 三张特性卡片；登录页去除品牌重复渲染；运营仪表盘卡片加彩色顶边
  与状态徽章；工作流操作条状态改为彩色徽章。全部通过 typecheck + build + 公网回归复验。

## 首页深度丰富 + 管理端大胆美化（2026-08-22，镜像 `mk-dev-e220638`，摘要 `sha256:072a1c5e...`）

- 方向：深蓝科技风（延续品牌 `#2563eb`/`#1d4ed8`）+ 自制线条 SVG 图标，零新增 npm 依赖。
- 新增 `apps/cms/src/app/(payload)/admin-theme.css`，在 `layout.tsx` 中 `@payloadcms/next/css` 之后引入，
  覆盖 `--theme-success-*` 色阶为蓝色系、`--style-radius-*` 加大圆角。实施前逐一核实 Payload 编译后 CSS
  确认真实生效范围：单选聚焦光晕/拖拽区/Toast/徽章由 `--theme-success-*` 驱动（已变蓝）；
  但 `.btn--style-primary`（Login/Save/Create 按钮）实际绑定 `--theme-elevation-800`、输入框聚焦边框绑定
  `--theme-elevation-400`、侧边栏当前页指示条 `.nav__link-indicator` 绑定 `--theme-text`——均与强调色无关，
  因此针对这三个真实类名单独覆盖，避免"改了变量但按钮没变色"的落差。
- 新增 `apps/cms/src/components/icons/index.tsx`（7 个线条 SVG 图标），替换仪表盘指标卡片与首页特性卡片的 emoji。
- 首页（`apps/cms/src/app/(public)/page.tsx`）新增品牌头条、按真实 ContentEdition 状态机简化的工作流程图
  （Draft → Review → Quality gate → Publish）、信任徽章条、装饰性渐变光斑；保留原有 `<h1>` 精确文案与
  `Open administration` 链接文案/href，回归断言未改动仍然成立。
- 验收：`pnpm --filter @geo/cms typecheck` 通过、CMS 单测 67/67、webpack 生产构建通过、smoke 通过、
  公网 `browser-admin-tests.mjs` 回归 17/17 PASS，逐张截图人工核对配色/图标/布局。
- 部署注意：本次两轮 `make image-build` 产出的镜像标签字符串与已部署标签相同（`mk-dev-e220638`，取决于
  git 提交哈希而非工作区改动），但镜像摘要不同；`docker compose up -d --no-build --wait` 在标签字符串不变
  时不会自动重建容器，需加 `--force-recreate` 才能让容器加载新内容——已确认 `docker inspect` 镜像摘要与
  最新构建一致后再放行。

## 首页深度丰富 + 管理端大胆美化（2026-08-22，镜像 `mk-dev-e220638`，摘要 `sha256:b892ad4...`，v2）

- 方向：深蓝科技风（延续品牌 `#2563eb`/`#1d4ed8`）+ 自制线条 SVG 图标，零新增 npm 依赖。
  设计语言参考 Linear/Vercel 类运营工具：深色侧栏、浅色画布+白色表面、细线表格+hover 高亮、大写微型列头。
- **管理端 v2（用户反馈 v1"看不出美化"后的加码）**：`admin-theme.css` 除色阶/圆角外，新增三块高可见度改动——
  1. 侧边栏深海军蓝（`.nav` 渐变背景 + `.nav__link`/`.nav-group__toggle`/`.nav__label` 强制深底配色，
     当前页指示条亮蓝加粗）；
  2. 列表表格精修（去掉 Payload 默认奇偶斑马纹，改行 hover 蓝色淡染、行间 1px 细线、
     列头 0.68rem 大写+字距微标签）；
  3. 内容画布浅蓝灰底 `#f4f6fb`（仅浅色主题），白色表面卡片感突出。
  另核实并定向覆盖：`.btn--style-primary` 实际绑定 `--theme-elevation-800`（非强调色）、
  输入框聚焦边框绑定 `--theme-elevation-400`、`.table` 类名（非 `.list-table`）。全部选择器写入前先从
  `@payloadcms/next/dist/prod/styles.css` 编译产物核实。
- **首页 v2**：在 hero/特性卡片基础上新增——数据带（7 工作流状态/3 层质量/2 站点主题/1-click 回滚）、
  工作流程卡片带角色徽章（Editor/Reviewer/Evidence/Publisher）、角色权限四卡（Editor/Reviewer/Publisher/
  Tenant admin，内容来自真实 RBAC 矩阵）、控制面/服务面双平面架构卡（来自 README 真实架构）、页脚。
  保留 `<h1>` 精确文案与 `Open administration` 链接，回归断言未改动仍成立。
- 图标集扩至 11 个（新增 Users/Globe/Layers/Lock），仪表盘与首页全部换用。
- 验收：typecheck 通过、CMS 单测 67/67、webpack 生产构建通过、smoke 通过、公网回归 17/17 PASS；
  逐张截图人工核对（`ov-01-homepage`、`ov-03-dashboard`、`list-sites`、`list-users`）；
  super-admin 租户列实时 DOM 复核显示 `Tenant 413/414`、editor 显示 `Current tenant`，角色分支正确。
- 部署注意：`make image-build` 镜像标签取 git 提交哈希，工作区未提交时标签不变但摘要不同；
  需 `docker compose up -d --no-build --force-recreate` 才会加载新内容，部署后以 `docker inspect`
  核对镜像摘要与最新构建一致。

## 产品化视觉系统 v3（2026-08-22，镜像 `mk-dev-e220638`，摘要 `sha256:834bb73a...`）

本轮依据排版、间距和信息密度审计重构公开页与 Payload 管理端，未引入外部字体、图标或图片依赖，也未修改 RBAC、工作流状态机、租户注入或数据模型。

- **公开页**：`apps/cms/src/app/(public)/page.tsx` 改为内容结构，展示样式迁移至 `page.module.css`。首屏为文案 + release workspace 面板的两栏布局；增加证据带、三项 outcome、语义化四步流程、控制/服务平面对比及最终 CTA。小屏变为单列，正式 workflow 在手机上改为纵向连接结构。
- **后台设计 token**：`apps/cms/src/app/(payload)/admin-theme.css` 定义系统字体、绝对像素的 2–48px spacing、12/14/16/24/28px 类型层级、40/44px 操作高度及 48px 标准表格行。不要将这些 token 改回 rem：Payload root rem 是 13px，会让预期的 14px 正文缩为 11.375px。
- **关键真实样式验收**：Kimi WebBridge 在公网 Sites 页面读取到正文 `14px/20px`、表头 `12px/16px`、表格行 `49px`、`overflow=0`。默认列已按运营扫描顺序显示 Name、Status、Locale、Timezone、Tenant、Updated At。
- **Dashboard / workflow**：自定义组件统一采用 token；正常库存中性化，仅失败项高亮；工作流操作使用全局主/次操作语言，不再存在独立渐变和发光。
- **回归保护**：`.test/browser-admin-tests.mjs` 继续 17 项功能/RBAC 回归，并对四个首页视口新增 CTA 不小于 120×44px、四步 workflow 结构和手机纵向顺序断言。最终 17/17 PASS，截图已更新到 `.test/artifacts/`。

本次实际部署流程：

```sh
PATH=/home/ubuntu/.n/n/versions/node/24.18.0/bin:$PATH make image-build
sudo docker compose --env-file /opt/geo-foundry/mk-dev.env \
  -f deploy/compose.yaml -f deploy/compose.mk-dev.yaml \
  up -d --no-build --force-recreate --wait --wait-timeout 180
deploy/smoke/smoke.sh
```

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:834bb73a3a33e45402e4cd54e763ee2c32acc03cf5c18462d48f107aaad76989`。

## Operations Dashboard + Sites Operations Workspace（2026-08-23，镜像 `mk-dev-e220638`，摘要 `sha256:34a63ebd...`）

本轮做的是结构级运营 UI 改造，不是继续调整 Payload 默认列表样式。

- **真正的 `/admin` Dashboard**：`payload.config.ts` 使用 Payload 的 `admin.components.views.dashboard.Component` 注册 `OperationsDashboard`，替换默认 Collection Cards 首页。Dashboard 从访问受限的 Payload Local API 读取真实内容版本、站点、域名、质量评估、操作、release 与 rollback intent；每项查询均为 `overrideAccess: false` 且传入当前用户。
- **页面结构**：Needs attention（review / compiled / quality issue / failed operation）、7 状态 workflow pipeline、Site fleet、release/operation/rollback 活动和按角色快捷入口。没有人为制造 KPI、release、hostname、uptime 或质量分数。
- **角色边界**：super-admin 为 `All tenants`；tenant-bound 人类为 `Current tenant`。Editor/Reviewer 没有 Releases 读取权时，Dashboard 和 Site card 显示 `Restricted`，不显示零或 release ID。Dashboard 不调用 internal endpoints，也不直接写 state-machine/ledger 字段。
- **Sites 页面**：`Sites.admin.components.beforeList` 注册 `SitesOperationsWorkspace`；它位于原始 Payload 搜索/筛选/表格上方。每张 card 从 Domains / Editions / Releases 关联事实派生 domain configuration、current release 与 workflow 计数；标准表格继续保留为 registry、筛选和批量管理界面。
- **真实零基线**：当前 embed browser baseline 有 3 sites，但 Domains / Releases 均为 0。因此工作区显示 `No domains configured` 和 `No current release`，而不插入演示数据。这个状态是可操作的真实配置缺口，不是 UI 故障。
- **测试**：新增纯 view-model 测试，CMS 单测 71/71 PASS。公网深度浏览器回归扩展为 18/18 PASS，新增断言 `/admin` 无默认 Collections 卡片区、Sites workspace 在原表格之前、真实 domain/release 空态可见。Kimi WebBridge 已人工验证 desktop Dashboard、desktop Sites workspace、tenant-scoped mobile Dashboard。

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:34a63ebd860e735be9311aeb496fde6eb29c50fbfac197edf9bc61faa3dbc485`。

## approved→compiled→published→rollback 全链路修复（2026-08-23，镜像 `mk-dev-e220638`，摘要 `sha256:ff18ef56...`）

发现并修复了内容发布链路里两处真正的架构缺口，此前"已发布"从未是可验证的真实事实：

- **`compiled` 不再是死记录**：`/internal/editions/:id/compile-results` 原来只落审计证据，从不推进 workflow 状态。现在同一事务里原子完成"记录证据 + `approved→compiled`"；对同一 release 的精确重放幂等返回 200，产物字段冲突返回 `EDITION_WORKFLOW_COMPILE_CONFLICT`（409）。
- **`published` 不再由服务身份伪装**：Publisher 不再直接调用通用 workflow-transitions 端点把状态改成 `published`（该端点已移除 `compiled`/`published` 两个 target）。新增 `/editions/:id/publish-operations`：publisher 会话提交一个真实、幂等（按 `edition+compiledRelease` 派生 key）的 publish operation；worker 完成真实编译重建（复用同一 `compiledRelease` 而非新铸造 release id）、真实 S3 上传、真实 release registry 写入后，`recordPublishedRelease` 从该 operation 的创建者身份中溯源出真正的 publisher 角色，在同一事务内推进 `compiled→published`——绝不接受服务身份自证。
- 顺带修复：内容服务写入生成草稿时曾绕过 PageDocument 正文契约校验，现在 fail-closed 返回 `EDITION_BODY_INVALID`（400）。

**公网真实验证**（Playwright 驱动真实登录会话，Kimi WebBridge 浏览器扩展本轮全程未连接 `extension_connected:false`，未能补做人工复验）：

1. Edition 542：真实 `approved→compiled→published`，Dashboard/Sites workspace/Content Editions 列表/Releases 列表数据一致，零控制台错误、零横向溢出。
2. Edition 543（第二次真实全链路，专为验证 rollback 产生第二条真实 release）：同样走完 `approved→compiled→published`；随后 publisher 真实创建 Rollback Intent（release2→release1），content-service 完成真实 CAS 指针切换回滚，release1 变回 `current`、release2 变为 `rolled_back`，intent `consumedAt` 落地；Dashboard「Current releases」「Pending rollbacks」、Sites workspace、Releases 列表、Rollback Intents 详情全部复核一致。
3. Operations 页面发现一个数据一致性问题：本轮验证时直接调用底层编译/发布函数、绕过了 worker 的 `operationProcessor` 包装层，导致真实已完成的 operation 卡在 `queued`；已用与真实 worker 相同的受保护 stage 端点补记真实结果，不影响其它任何执行路径（生产 worker 本身走 `operationProcessor` 不受此影响）。

**发现的 UI/流程缺口（不在本次修复范围，如实记录）**：

- URL Records 集合没有任何生产路径会调用其 `reserveUrlRecord`/`activateUrlRecord` 服务函数，只在自身集成测试中使用；当前系统里没有合法方式产生一条 URL Record。
- `/api/rollback-operations/intents`（session 认证、非 internal）存在，但没有任何后台组件提供对应的按钮/入口。
- 既有、与本次改动无关的两个缺陷：`tenant-access.test.ts` 中 editor 读取 users 集合未被正确拒绝；`rollback-control-plane.test.ts` 中跨租户回滚意图误报为 `NOT_FOUND` 而非 `MISMATCH`。

**清理**：Release/Operation/Rollback Intent 三个集合的访问策略对所有角色都是 `delete:false`（不可变账本，产品设计如此），且其 `site`/`tenant` 为必填外键。本轮验证产生的 2 条真实 Release、约 3 条 Operation、1 条 Rollback Intent 已合法落库并引用了本轮 run 的 Tenant 415 / Site 377，因此无法在不违反"账本永不删除"这一产品安全设计的前提下清空这批临时数据；已就清理策略征询用户但未获回复，按最低风险默认保留全部数据作为本次全链路验证的真实证据，未执行任何删除。

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:ff18ef566834a3866c97e5aec7349800b812a6b356543409879adda938f7c103`。

### Kimi 真实浏览器复验补全（同日，最终镜像摘要 `sha256:676b679f...`）

前文"Kimi 扩展未连接"的结论有误：本机的 kimi-webbridge 已清理，实际通过 SSH 隧道连接远程机器上的实例（`extension_connected:true`）。用真实 publisher 会话完成全部欠账复验，并发现/修复两个新缺陷：

- **Releases 列表 Site 列显示 `<No Site>`**：API 数据 `site=377` 正常，但默认关系单元格在该列表永不水合（等待后依旧，非时序问题）。修复：`Releases.site` 注册既有 `SiteCell` 组件（与 ContentEditions 同模式）。
- **Rollback Intents 列表同样显示 `<No Site>`**：同根因，同修复（`RollbackIntents.site` 注册 `SiteCell`；详情视图本就正常）。

复验结果（证据：`.test/admin-ui-evidence/<runId>/kimi-verification-result.json`）：

| 页面 | 结果 |
|------|------|
| Dashboard | pipeline `Published 2`（其余 0）；Current releases = 回滚后的 `rel-c35b6b7b…`；Pending rollbacks 显示无待处理；Recent operations = rollback·succeeded + publish·succeeded×2；overflow 0 |
| Edition 542/543 详情 | workflow 区 `Current state / Published / Archive edition`；同 session API 确认 published + 各自 compiledRelease；overflow 0 |
| Content Editions 列表 | 两条均 published，Site 列已水合为真实站点名；overflow 0 |
| Sites workspace | Release = `rel-c35b6b7b…`，Workflow = `2 published`；overflow 0 |
| Releases 列表 | 修复后 Site 列显示真实站点名；`rolled_back` + `current` 状态正确；overflow 0 |
| Operations 列表 | 3 条记录全部 succeeded、attempt 1；overflow 0 |
| Rollback Intents | 修复后列表 Site 列水合；详情含 Site 与 Consumed At；API `consumedAt=2026-08-23T08:00:35.021Z`；overflow 0 |

两处修复后 CMS 单测 83/83 通过，重新构建部署并即时复验生效。

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:676b679f74d4e3308edb44199b6bee35233b13c13afd5600a100d8e404cfa33a`。

## 管理端信息架构与视觉层级清理（2026-08-23，最终镜像 `mk-dev-e220638`，摘要 `sha256:d8b6d50a...`）

用户反馈"表单/菜单/列表/详情各种页面设计上不够整洁、清爽、直观"。逐项核实为真实缺陷（非主观印象），分五轮 typecheck→单测→`make image-build`→`docker compose --force-recreate --wait`→`smoke.sh`→Kimi 公网复验：

1. `TenantCell` 从未在 `depth=0` 的 list 视图解析真实租户名（super-admin 全站看到裸 `Tenant 413`）；套用 `SiteCell` 同款"同源 session 请求 + per-user 缓存"修复，同轮清理死代码 `OperationsWorkspace.tsx`/`pillClass()`，补 `Tenants`/`Users` 的 `defaultColumns`、`RollbackIntents` 的 `useAsTitle`。
2. `admin-theme.css` 用蓝色 ramp 覆盖了 Payload 原生 `--theme-success-*` token（经查 `@payloadcms/ui` 源码确认），改名 `--gf-accent-*` 并新增语义化 `--gf-tone-{success,warning,danger,neutral,accent}-*`，映射回 Payload 未被污染的原生 ramp。
3. 新增 `apps/cms/src/components/ui/`（`Badge`/`IconBadge`/`ActionLink`），替换三处并行、互不一致的卡片/徽章/按钮手搓实现。
4. 视觉层级修复：`WorkflowActions` 徽章改用共享 tone 映射；Dashboard 零计数时 needs-attention 图标与 7 段 pipeline 边框强制中性色（不再空态告警撞脸）；Sites workspace 卡片操作建立主/次按钮层级；`Restricted` 权限态改用 Badge 而非巨大数字排版。Kimi 复验中额外发现并修复两处 CSS 选择器优先级泄漏（旧描述符选择器覆盖了新组件的单类选择器，导致主按钮文字对比度失败、徽章字号被拉大），加 `:not(.gf-ui-*)` 隔离后复验通过（primary 按钮白字蓝底对比度正确，Badge 12px 字号正确）。
5. Content Edition body block 里每个类型都携带的原始 `Extensions` JSON 编辑器确认是应用自定义字段（非 Payload 默认），改用 Payload `collapsible` 字段类型默认折叠，不改变存储数据形状。

验证：CMS 单测 83/83 → **90/90 PASS**；全量 integration 回归重跑通过（除两个此前已记录、与本轮无关的既存缺陷外）；typecheck 全程 clean。详见 `.test/browser-test-plan.md` 同名章节。

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:d8b6d50a11ab9c276c52213d161e4adf664d9e52f154f34f93fe7211c25d5745`。

## GF Studio 管理端全新设计系统（2026-08-24，最终镜像 `mk-dev-e220638`，摘要 `sha256:7c3a0695...`）

用户要求"大胆推翻原来的前端库，可以用 Tailwind，尽量适配手机端，追求美观大方整洁高级"，并追加"多语言也可以顺便考虑，或者中文为主"。这是一次结构级换肤，不是继续调 token：

- 引入 Tailwind v4，仅作用于 `(payload)` 路由组（新增 `admin-tailwind.css`，不含 preflight，`source(none)` + 单一 `@source` 严格限定扫描范围，排除与 Payload 原生 `.table` 冲突的工具类），Payload 全部原生功能件（列表/筛选/字段编辑器/批量操作）保持不动。
- `admin-theme.css` 按 Payload 官方 `--theme-*` 变量命名重建浅色 + 深色两套完整 token（bg/input-bg/text/elevation-0..1000/success/warning/error 全 ramp），主色改靛蓝 `#4f46e5`，Payload 存量 UI 全部通过变量自动换肤。
- `payload.config.ts` 注册官方简体中文翻译包为 `fallbackLanguage`：中文浏览器默认中文界面，英文浏览器仍可用英文，无需手动切换。
- 修复真实字号 bug：Payload 根字号是 13px 非常见的 16px，Tailwind 默认 rem 工具类会整体缩小 ~19%；在 `admin-tailwind.css` 的 `@theme` 块用 `calc(原值 * 16/13)` 重新校准 spacing/text/radius 三套内部尺度。
- `OperationsDashboard`、`SitesOperationsWorkspace`、`WorkflowActions`、`LoginIntro` 四个自定义组件用 Tailwind 全部重写呈现层并中文化，数据获取/RBAC/工作流请求逻辑逐行保留。

验证：typecheck clean；CMS 单测 90/90；每轮独立构建部署 + Kimi 公网复验（过程中发现并修复两处 CSS 选择器优先级泄漏）；收尾用真实 Playwright 对公开首页 4 视口（1440/1024/768/375）与管理端 4 角色跑完整回归，**17/18 PASS**（唯一失败为集合行数与测试脚本旧硬编码期望值不符，纯基线数据增长，12 个集合 console error 均为 0，与本轮无关）；同步修复该脚本里 3 处英文文案断言为对应中文。详见 `.test/browser-test-plan.md` 同名章节。

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:7c3a06955186f7161d72fe62baaf34528a252389f94465821867d4416fb3c5e4`。

## GF Studio 原生列表/表单页视觉打磨补课（2026-08-24，最终镜像 `mk-dev-e220638`，摘要 `sha256:1dc1e4c2...`）

用户反馈"样式和排版还有各种表单表格的样式还是丑"。用真实 Playwright（非 Kimi——本轮 Kimi WebBridge 截图文件落在远程宿主，本地读不到）登录后对 Users/Content Editions/Sites 列表页与 Edition 详情页截图核实，发现反馈属实：上一轮"全站换肤"只做了 `--theme-*` token 重着色（表格文字色、边框色、输入框圆角确实生效），但 `.list-header`/`.search-bar`/`.pill`/`.table-wrap`/`.page-controls`/`.doc-header`/`.doc-tabs`/`.doc-controls__wrapper` 这些真实容器选择器此前从未被样式化（其中 `.collection-list__header` 还是个从未匹配过的死选择器，真实类名是 `.list-header`），导致表格直接贴在画布背景上、无卡片无阴影，"Create New" 仍是 Payload 默认灰色 pill，视觉上与换肤前几乎无差别。

修复（对照真实 DOM 逐个核对选择器，非猜测）：

- 列表页：`.list-header__title` 放大加粗、`.list-header__title-actions .btn--style-pill`（Create New 真实使用的是 pill 样式而非 primary，之前完全没覆盖）改用 `--bg-color`/`--color`/`--hover-bg`/`--hover-color` 四个 Payload 自有 custom property 钩子染成实心靛蓝；`.list-controls`（搜索栏+筛选 pill 所在行）、`.collection-list__tables .table-wrap`（表格容器）分别升级为白色卡片+圆角+阴影；`.pill`/`.pill--style-light`/`.pill-selector__pill--selected` 补齐边框与选中态靛蓝；`.page-controls`/`.paginator__page`/`.per-page` 补分页交互态。
- 表单/详情页：`.doc-header__title` 同步放大加粗；`.doc-controls__wrapper`（状态+操作按钮条）升级为卡片+阴影；`.doc-tab--active` 补靛蓝高亮（真实类名是 `.doc-tab`/`.doc-tab--active`，不是之前以为的 `.tabs-field__tab-button--active`，那个类只对 Tabs 字段类型生效，不覆盖文档级 Edit/Versions/API 标签）。
- 排查中确认深色模式下 Citations/Entities 等 JSON 字段的 Monaco 编辑器显示为刺眼白底是测试方法误差（用 `element.setAttribute("data-theme","dark")` 直接改 DOM 属性绕过了 Payload 真实的主题切换 React 状态，Monaco 因此没重新收到深色主题指令）；改用账号设置页真实的 Dark 开关验证后，Monaco 正确跟随深色主题，确认不是产品缺陷。

验证：CMS 单测 90/90（纯 CSS 改动，未触及任何 TS 逻辑）；`browser-admin-tests.mjs` 全量回归 17/18 PASS，与上一轮同一个已知基线问题（集合行数硬编码过期，12 个集合 console error 均为 0），无新增回归；Playwright 直接截图复验列表页/详情页/移动端 390px/深色主题，确认卡片、阴影、pill 靛蓝、分页 hover、doc-tabs 高亮均生效，无横向溢出。

最终运行容器：`geo-foundry-cms-mk-dev`，health=`healthy`，image digest=`sha256:1dc1e4c2c34dd777f2ce2fd0a1a566dcbf7a36eea0660a9142a85c1e23e76242`。

### 附带发现、排查并修复：mk-dev 应用容器反复被"误删"

本轮工作期间 `geo-foundry-cms-mk-dev` 容器共消失 3 次（公网 502，`docker ps -a` 无记录，非 Exited 而是彻底不存在）。前两次深入排查了 `docker events`、dockerd journal、cron/systemd timer、watchtower、其它已登录会话、OOM、同宿主机上另一个常驻 AI 代理（opencode）的会话存储，均未找到直接证据——dockerd 的 `task-delete` 事件只记内部哈希 ID，不记容器名也不记发起者，`auditd` 又未启用，日志源头就没留下能定位"谁做的"的证据。

第三次由用户从另一个 AI 会话得到确认：那边在清理 `medical-data-service` 的测试容器时执行了 `docker compose down --remove-orphans`，误将 `geo-foundry-cms-mk-dev` 判定为孤儿容器一并删除。核实机制：本项目的 compose 调用此前从未显式设置项目名，Compose 默认取 **compose 文件所在目录名**作为项目名——这里是 `deploy/compose.yaml`，目录名 `deploy` 极其通用，与另一个项目同样未命名、也默认解析成 `deploy` 的 compose 栈发生了项目名碰撞；`--remove-orphans` 按项目名匹配"孤儿"，于是跨项目误删。

**修复**：在 `deploy/compose.yaml` 顶层加显式 `name: geo-foundry-${COMPOSE_ENV}`，把项目名从通用的 `deploy` 钉死为 `geo-foundry-mk-dev`（verify 环境为 `geo-foundry-verify`），彻底避免和其它未命名项目发生项目名碰撞。修复后 `docker inspect` 确认 `com.docker.compose.project=geo-foundry-mk-dev`，`smoke.sh` 与公网复验均通过。未采用"自动看护/自动拉起"脚本（用户明确要求不用，此修复是消除误删的根因，不是给误删兜底）。

## 独立 shadcn/Tailwind Console 正式接管 `/admin`（2026-08-26，commit `f524ae0`，镜像 `mk-dev-f524ae0`，摘要 `sha256:62151763...`）

用户最终确认“全部页面去掉 Payload，用 shadcn/Tailwind 实现”，但保留 Payload 作为唯一后端（auth Cookie、REST/Local API、schema、RBAC、tenant scope、S3、草稿/版本、发布/回滚审计）。本轮以独立分支 `feat/console-admin-shadcn` 完成并正式部署：

- `/admin` 是独立 Next Console：不加载 Payload `RootLayout`/`RootPage`/Admin CSS，不使用 `@payloadcms/ui`；提供中文优先的响应式 Shell、深浅主题、登录/忘记密码/重置密码/账户、12 个资源列表/详情、Users/Sites/Contents/Domains 受控 create/edit、Media multipart 上传、URL rename、publisher-only rollback intent 和 Content Edition Studio。
- 所有浏览器读写继续使用同源公开 `/api/*`，读取在服务端带当前 Payload user + `overrideAccess:false`；Console 绝不请求 `/api/internal/*`。关系在可读时 `depth:1` 水合；否则显示“受限”，不显示裸 ID。
- `payload.config.ts` 顶层 `routes.admin` 改为 `/admin/_emergency`。Payload 原生 Admin 保留在此 super-admin-only emergency subtree：源码目录 `%5Femergency` 映射公开 `_emergency` URL（Next 将裸 `_` 目录视为私有）；子树单独加载 Payload RootLayout/CSS/RootPage，并通过同一 HTTP-only Payload cookie + `resolveSessionClaims()` 预先限制 super-admin。普通用户无导航入口且直接 URL 不会获得原生 Admin。
- 旧 `/console/*` 跳转到 `/admin/*` 并保留查询参数；旧 `/admin/work*`、Release history、Tenant workspace/diagnostics 深链通过服务器 RBAC 跳到 Console 对应页或 emergency fallback，不能绕过权限。

**验收**：typecheck clean；CMS unit 140/140 PASS；Biome lint 0 error；production route manifest 已包含 `/admin`、`/admin/_emergency/[[...segments]]`、`/console/[[...segments]]`。镜像构建后 compose recreate 与 `smoke.sh` 均 PASS。真实 Chromium 全量回归 `browser-admin-tests.mjs` **18/18 PASS**（公开首页 4 视口、Console login/recovery、Dashboard、12 resources、服务集合 404、Media upload、Contents detail、editor self-account 和 tenant field、Sites denied create、tenant-admin/foreign-admin 隔离）。

**重要部署纪律**：本轮第一次部署的 Console 镜像随后被另一轮工作将 `/opt/geo-foundry/mk-dev.env` 的 `IMAGE_TAG` 切到 `mk-dev-a40fd52` 覆盖，导致公网重新出现 Payload 原生集合页。不是 CDN 缓存。最终以已提交的 `f524ae0` 生成唯一镜像 `mk-dev-f524ae0`，将 `IMAGE_TAG` 显式切到该 tag 后 compose recreate，并用 `docker inspect geo-foundry-cms-mk-dev` 确认实际 digest 为 `sha256:621517639d5aa8485c81bd868e764368c81c55a8b8b9d76aa72784505249b580` 才执行验收。后续并行部署前必须确认当前 target branch/IMAGE_TAG，避免无意覆盖 Console。

## 回滚

1. `sudoedit /opt/geo-foundry/mk-dev.env` 将 `IMAGE_TAG` 改回上一 `mk-dev-<sha>`。
2. `make rollback-mk-dev`。
3. 验证 watchtower 目标恢复 healthy。
