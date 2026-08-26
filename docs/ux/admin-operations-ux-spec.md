# 管理端运营 UX 规范

- **状态**：现行体验与验收基线
- **范围**：`/admin`、站点工作区、内容版本工作流及其登录、列表、详情和权限反馈。
- **原则**：控制面只展示当前身份按既有 access scope 可读的数据；界面不绕过服务端工作流、租户隔离、质量门禁或发布 CAS。

## 1. 用户、目标与非目标

| 用户 | 首要目标 | 主要入口 |
| --- | --- | --- |
| editor | 创建内容、推进生成、提交审核 | Dashboard、Contents、Content Editions |
| reviewer | 找到待审版本、批准或退回修改 | Dashboard 待处理、Edition 详情 |
| publisher | 找到已编译版本、请求发布、归档、查看发布/回滚账本 | Dashboard、Edition、Releases、Rollback Intents |
| tenant-admin | 管理本租户站点、域名和运营全景 | Dashboard、Sites workspace |
| super-admin | 跨租户治理与全局排障 | Dashboard、Sites workspace |
| content-service | 调用内部集成接口 | 不使用人工控制台 |

本规范不新增权限、领域状态、内部端点或写入路径。Payload 原生集合列表、搜索、筛选、列偏好、批量操作与表单能力仍是登记和编辑的基础；运营工作区是只读的、由现有记录派生的行动层。

## 2. 体验原则

1. **先行动，后明细**：首页先给待处理、工作流、站点就绪度和操作健康度；每个指标可进入带条件的现有登记页。
2. **真实且按范围**：所有查询以当前会话和 `overrideAccess=false` 运行。无权限显示“受限”，空数据明确为空，绝不以 `0`、假 hostname、假 release 或其他占位值混淆两者。
3. **角色最小化**：仅显示该角色可执行的快捷操作、工作流按钮和台账；服务身份看到明确的非人工控制台说明。
4. **状态可解释**：状态文字是准确信息源，颜色只作辅助。发布成功只用于 `published`；审核中、风险、受限和空态不得互相混淆。
5. **不绕过后端**：工作流按钮只调用既有会话认证端点；角色、租户、质量、编译和乐观 revision 检查仍由服务端决定。
6. **中文优先、可回退英文**：中文浏览器默认中文；非中文语言保留英文文案，不把业务状态翻译成不精确的营销词。

## 3. 信息架构与页面契约

### 3.1 登录与进入控制台

- 匿名访问受保护页面进入登录流程；登录页说明“内容运营中心”及内容版本、质量审核、发布与分发的用途。
- 成功登录后进入 `/admin`。认证页不依赖第三方头像或其他非必要外部请求。
- 人类角色进入运营指挥台；`content-service` 不获得人类运营界面，并被告知应使用内部集成接口。

### 3.2 运营指挥台 `/admin`

页面以“运营指挥台”为主标题，显示当前范围标识：super-admin 为“全部租户”，租户绑定角色为“当前租户”。页面由以下区块组成：

| 区块 | 展示内容 | 行动/约束 |
| --- | --- | --- |
| 概览 | 启用站点、待审核、待发布、风险事项、当前发布版本 | release 不可读时显示“受限”，不显示数值或 ID |
| 待处理事项 | 待处理回滚、失败操作、质量证据、域名配置、审核队列、待发布 | 按运营影响排序；只显示当前会话可读记录 |
| 工作流管线 | `draft → generating → review → approved → compiled → published → archived` 的数量 | 点击状态进入对应的 Content Editions 筛选结果；瓶颈仅在可处理队列非零时提示 |
| 配置就绪度 | 主域名与当前发布版本派生的 ready / publish / configure / disabled / restricted | 这是配置代理指标，不得描述为 uptime/健康监控 |
| 站点工作负载 | 按配置风险和可处理工作排序的站点 | 显示审核、已批准、已编译、已发布的工作量；链接到站点详情 |
| 操作健康度 | generate / evaluate / publish / rollback 的 queued、running、succeeded、failed、cancelled 分布 | 仅有操作读取权限的角色可见；这是可见记录快照，不是时间窗口成功率 |
| 台账与最近记录 | 发布、操作与回滚的可见记录 | 无记录显示明确空态；每条可到详情页 |

Dashboard 必须保留面向角色的主操作：editor 创建内容、reviewer 打开审核队列、publisher 打开待发布版本、tenant-admin/super-admin 打开站点工作区。指标和卡片不得代替原始登记页，也不得写入或修改底层记录。

### 3.3 Sites workspace `/admin/collections/sites`

站点列表上方显示只读“站点工作区”，下方原始 Payload Sites 登记表保持可搜索、筛选、列偏好和批量管理。

- 头部展示可见站点/启用站点数量及范围标识。
- 汇总卡显示站点、启用中、待配置域名、当前发布版本；无 release 读取权时最后一项必须显示“受限”。
- 每张站点卡基于 Sites、Domains、Content Editions 与（允许时）Releases 派生：启用/停用、主域名、别名数量、当前 release、工作流工作量和更新时间。
- 无主域名、停用主域名、无 release 与无站点均为真实状态，必须有明确文案；不得伪造 hostname 或 release。
- 主操作只有“打开站点”；域名、版本、发布历史和编辑配置是次级操作，并仍受既有角色权限约束。

## 4. 内容版本工作流

状态及合法业务含义由领域层定义：`draft`、`generating`、`review`、`approved`、`compiled`、`published`、`archived`。详情页中的工作流面板显示当前状态和当前角色可用的下一步，其他角色或状态不显示无效动作。

| 角色与状态 | 可见操作 | 反馈与保护 |
| --- | --- | --- |
| editor / draft | 开始生成 | 进入 `generating` 后刷新详情 |
| editor / generating | 提交审核；退回草稿 | 成功后显示目标状态；失败保留当前页面和输入 |
| reviewer / review | 批准版本；退回修改 | 仅在审核中显示；服务端复核角色和租户 |
| publisher / compiled | 发布版本 | 提交异步发布请求，明确说明“将在后台完成”，不提前宣称已发布 |
| publisher / published | 归档版本 | 成功后刷新为 `archived` |
| editor / published | 创建新草稿 | 从已发布版本派生新的 draft，不改写已发布版本 |

质量评估未通过、版本未编译、角色不足、陈旧 revision 或其他端点错误必须给出可理解的 toast/页面反馈。客户端不能自行修改 `workflowStatus`，不能把提交成功误报为发布完成。

## 5. 租户、权限与数据可见性

- 所有运营概览、链接目标和详情只能包含当前角色可读的记录；UI 隐藏不是安全边界，后端必须再次拒绝越权请求。
- tenant-bound 用户创建 Contents 或 Media 时不选择 Tenant，服务端从会话强制注入；列表关系无法读取名称时使用“当前租户”或安全降级，不显示 `Untitled - ID` 之类的噪音。
- 没有集合 create 权限但已登录时，页面应说明缺少权限，不能误导为“必须登录”。
- 不可读的 Releases、Operations、Rollback Intents 只显示“受限”及必要的角色说明，绝不通过数量、ID、链接或错误文案泄漏跨租户/受保护信息。
- 服务自有集合 `outbox-events`、`idempotency-records` 不进入侧栏，直接访问管理页为 by-design 404。

## 6. 视觉、交互与可访问性

- 视觉系统使用语义 token：品牌强调、成功、警告、危险、中性；不能把成功 token 复用为品牌色。
- 主/次按钮层级明确，关键触控目标最小 44px；禁用或执行中的按钮不可重复提交，并有处理中状态。
- 状态使用文字、徽章和颜色共同表达，满足非色觉用户识别；受限与零计数采用中性呈现。
- 桌面与 375px、768px、1280px、1440px 视口均不得横向溢出；仪表盘、站点卡、工作流动作和原生表格/表单在窄屏可阅读、可操作。
- 键盘可到达链接、按钮、筛选与表单控件；焦点可见；关键页面使用语义标题、列表和可访问名称。关键路径以 axe 检查严重违规。
- 登录、Dashboard、站点列表、版本详情和创建表单不得产生 hard console error；网络失败和空态须向用户解释，不能呈现空白页。

## 7. 验收与证据

验收用例、优先级和状态账本见 [`.test/requirements/15-admin-operations-ux.md`](../../.test/requirements/15-admin-operations-ux.md) 与 [`.test/requirements/execution-matrix.md`](../../.test/requirements/execution-matrix.md)。

每轮至少记录：环境、身份/租户、URL、视口、步骤、可见结果、网络/console、相关记录 ID、截图或抓包、状态词和清理结果。需要写入的工作流验收只能使用隔离 fixture 和合法公开/会话路径；不得调用 `/api/internal/*`、篡改状态字段或将凭据写入证据。
