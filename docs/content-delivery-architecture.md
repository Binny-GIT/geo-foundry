# 内容生产与多站交付架构

- **状态**：目标架构（部分已实现，部分待建设）
- **日期**：2026-09-23
- **范围**：从外部采集到文章在各合作站点可被搜索引擎收录的完整链路
- **约束来源**：[产品说明](product.md) 4.3、5.4（一稿多发与品牌版本）、[ADR 001 控制面与服务面分离](adr/001-control-plane-serving-plane.md)、[ADR 004 质量阈值 fail-closed](adr/004-quality-thresholds-fail-closed.md)、[ADR 007 内容运营领域模型](adr/007-content-operations-domain-model.md)

本文是全链路流程的权威图示。数据模型见[架构说明](architecture.md)，投稿接口契约见[集成投稿](intake-integration.md)。

图中标注：**实线框**＝已实现，**虚线框或虚线箭头**＝待建设。

---

## 1. 全景流程

一篇文章从线索到被收录，要穿过四个阶段：**采集 → 编辑 → 发布 → 交付**。前三个阶段在控制面，第四个阶段在服务面。

```mermaid
flowchart TB
    subgraph S1["① 采集：线索进来"]
        CR["crawl 采集服务<br/>crawl.xllent.dev"]
        EXT["外部工具<br/>n8n / Dify / 脚本"]
        MAN["人工登记线索"]
        INBOX[("稿源收件箱<br/>intake_items")]
        CR -.->|"完成通知 + HMAC<br/>geo 回拉结果"| INBOX
        EXT -->|"gfa_ 密钥投稿"| INBOX
        MAN --> INBOX
    end

    subgraph S2["② 编辑：线索变成文章"]
        ADOPT["人工采纳<br/>选题判断"]
        WRITE["撰写 / AI 助手改写<br/>原文进 citations"]
        META["补齐元数据<br/>作者 · 目录 · 发布站点"]
        QA["质量评估<br/>内容检查 + 每个发布站点的站点相关检查"]
        REVIEW["审核与审批"]
        INBOX --> ADOPT --> WRITE --> META --> QA --> REVIEW
    end

    subgraph S3["③ 发布：对每个发布站点"]
        URL["URL 预留<br/>每站一条 url_records"]
        COMPILE["编译该站快照<br/>PageDocument + routes.json + sitemap"]
        RELEASE["发布该站 release<br/>对象存储 + CAS 指针切换"]
        REVIEW -->|"approved"| URL --> COMPILE --> RELEASE
    end

    subgraph S4["④ 交付：服务面，只读 release"]
        HOST["交付服务<br/>createRuntime 宿主"]
        T1["第 1 层：JSON + 站点自渲染"]
        T3["第 3 层：子目录反向代理<br/>+ 每站外壳"]
        RELEASE --> HOST
        HOST --> T1
        HOST --> T3
    end

    subgraph S5["合作站点"]
        NK["NKMed<br/>Next.js"]
        DN["Dianordic<br/>Nuxt3"]
        AX["Aixllent<br/>aixllent-website"]
        OTHER["未来站点<br/>WordPress / 第三方"]
        T1 --> NK
        T1 --> DN
        T3 --> AX
        T3 --> OTHER
    end

    style META stroke-dasharray: 5 5
    style URL stroke-dasharray: 5 5
    style HOST stroke-dasharray: 5 5
    style T1 stroke-dasharray: 5 5
    style T3 stroke-dasharray: 5 5
```

**两处断点**：

1. **发布链路只认单个站点**（第 2 节）。URL 预留、编译快照、发布操作、质量评估四处全部只取单数 `site_id`，一稿多发只存在于数据层和 Console。图中第 ③ 阶段"对每个发布站点"是待建设的形态。
2. **服务面没有生产宿主**。`createRuntime()` 只被单测和 `examples/` 下两个测试夹具调用（[架构说明](architecture.md)第 187 行明确它们"不是产品的一部分"），编译产物没有生产消费者。`workflowStatus=published` 的真实含义是"产物就绪"，不是"网上能访问"。

第 2 层（静态 HTML 投放）没有出现在全景里，因为当前三个站都不适用；它面向有可写站点根目录或对象存储静态托管的站点，见第 6 节。

---

## 2. 发布链路多站化

`content_editions.sites` 是数组，但发布链路从不读它：

| 环节 | 位置 | 当前行为 |
| --- | --- | --- |
| 新建文章 | `apps/cms/src/server/repositories/editions.ts:212` | `site_id = site ?? sites[0]` |
| URL 预留 | `apps/cms/src/server/repositories/edition-workflow.ts:396-401` | 只为 `site_id` 预留 |
| 编译快照 | `apps/cms/src/server/repositories/compile-snapshot.ts:86` | 按 `site_id` 选文章 |
| 发布操作 | `apps/cms/src/server/repositories/publish-operations.ts:52` | 只发 `site_id` |
| 质量锚点 | `apps/cms/src/services/embedding-store.ts:56,72` | 只按 `site_id` 做同站比较 |
| 改站点分配 | `apps/cms/src/server/routes/edition-ops.ts:45,197-199` | 只允许 draft 到 approved，已发布文章改站点报 `EDITION_ASSIGNMENT_SITE_LOCKED` |

结果是勾选多个站点、实际只发第一个，且不报错；而数据库直读的 `/api/delivery/*` 按 `sites` 数组列文章（`apps/cms/src/server/routes/delivery.ts:164`），其他站点能列出这篇文章但拿不到 URL。

目标形态：新增 `edition_sites` 记录每站的发布事实——发到哪些站、每站的 URL、release 与发布状态。按产品说明 5.4，**每个站点发布的都是文章本身的内容，不做站点变体**。发布状态按站拆开，落实 ADR-007 已决定的"编辑状态 / 发布状态 / 质量状态"三维拆分。

```mermaid
flowchart TB
    EVAL["质量评估（审批前，ADR-004）<br/>内容规则 + LLM：每篇一次<br/>站点相关语义检查：每个发布站点一次"]
    APPROVE["审批通过"]
    ADD["已发布文章追加站点 C<br/>只对 C 跑站点相关检查<br/>内容不变，不重走编辑审核"]
    EVAL -->|"全部显式 passed"| APPROVE
    APPROVE --> FAN{"遍历 edition_sites<br/>中待发布的站点"}
    ADD -->|"passed"| FAN

    subgraph PER["对站点 S 独立执行"]
        RSV["预留该站 URL<br/>slug 同源于文章标题，按站登记"]
        CMP["编译站点 S 快照<br/>按成员关系选文"]
        REL["发布站点 S 的 release"]
        OK["edition_sites.publish_state<br/>= published"]
        FAIL["edition_sites.publish_state<br/>= failed，可单站重试"]
        RSV --> CMP --> REL --> OK
        REL -.->|"编译或存储失败"| FAIL
    end

    FAN --> RSV

    style ADD stroke-dasharray: 5 5
    style FAN stroke-dasharray: 5 5
    style PER stroke-dasharray: 5 5
    style OK stroke-dasharray: 5 5
    style FAIL stroke-dasharray: 5 5
```

**部分失败是常态**：A 站成功、B 站失败时，文章的编辑状态不变，只有 B 站的发布状态记为失败并可单独重试。

**站点相关检查必须按站跑**：同站标题查重与跨站内容查重都以站点为锚点，现在只以主站点为锚点。另外相似度查询（`apps/cms/src/services/embedding-similarity.ts:53-67`）按 `embeddings.site_id` 过滤，而该列只记主站点，别的文章做同站查重时看不到"这篇也发在 B 站"——查询需改为按成员关系过滤。

**撤下站点**与追加对称：该站 URL 转 gone（410）→ 发布该站新 release → 发出 `unpublished` 事件（第 7 节），不影响其他站点。

---

## 3. 采集：crawl 主动推

crawl 现状是纯拉取（建任务后由消费方轮询）。目标是 **crawl 在任务完成时主动通知 geo**。通知只带任务 ID 与状态，结果由 geo 回拉：集成与内部接口的请求体上限都是 1 MiB，一次采集十篇中文长文就可能超过；瘦通知还让推送与对账共用一条摄取路径。

```mermaid
sequenceDiagram
    autonumber
    participant CRON as geo worker<br/>每分钟 cron
    participant GEO as geo CMS
    participant ING as geo 摄取任务<br/>pg-boss
    participant CC as crawl Console
    participant CW as crawl Worker<br/>局域网 Mini PC

    Note over CRON,CC: 派发
    CRON->>GEO: 扫描到期的 crawl 连接器
    GEO->>CC: POST /api/jobs<br/>params.callback = 回调地址 + 密钥引用名
    CC-->>GEO: 201 jobId
    GEO->>GEO: 记录 jobId，状态 dispatched

    Note over CC,CW: 执行
    CW->>CC: 长轮询领取任务
    CW->>CC: POST /api/jobs/:id/complete

    Note over CC,ING: 推送（待建）
    CC->>GEO: POST 回调 {deliveryId, jobId, status}<br/>X-Crawl-Signature: HMAC-SHA256
    GEO->>GEO: 验签，按 deliveryId 去重
    GEO->>ING: 入队摄取，键为 jobId
    GEO-->>CC: 202
    ING->>CC: GET /api/jobs/:id
    CC-->>ING: 任务结果
    ING->>ING: 逐篇落稿源收件箱<br/>按归一化 URL + 内容哈希去重
    ING->>CC: DELETE /api/jobs/:id（回执）

    Note over CRON,ING: 对账（兜底）
    CRON->>GEO: 扫描 dispatched 超时未收到通知的任务
    GEO->>ING: 入队同一个摄取任务
```

**设计要点**：

1. **两层幂等**。投递级用 `deliveryId` 挡同一次通知的重试；文章级用归一化 URL 与内容哈希挡跨任务的重复采集（复用现有 `normalized_url` / `content_hash` 索引）。只用投递 ID 挡不住第二天新任务带来的重复。
2. **摄取成功后回执删除 crawl 侧任务**，同时解决 crawl `jobs.json` 无限增长的问题。
3. **crawl 通道永不自动成稿**。`autoAdopt` 是 gfa_ 密钥的属性，crawl 走连接器通道天然不经过自动成稿分支；`shouldAutoAdopt` 对 crawl 通道显式返回 false，防止被转投 webhook 通道绕过。采集稿是他站原文，定位是选题线索与素材。
4. **出站凭据**：crawl 的 API 密钥与回调 HMAC 密钥放服务器凭据文件，连接器的 `secret_reference` 只存引用名（该列目前全仓零引用，需补读取逻辑）。
5. **crawl 侧待补**：图片 URL 绝对化、任务删除接口、robots.txt 遵守与按域名限速、毒任务重领上限、Worker 离线时的租约定时回收。

---

## 4. 编辑：一稿多发与品牌版本

按[产品说明](product.md) 5.4：**一篇文章可以选择多个发布站点，以相同内容发布到每个站点，不设主从，不做站点变体**；需要针对品牌差异化时，用文章详情里现成的「复制为新草稿」复制成独立文章，改写后发到目标站点。

两条路由现有的跨站语义门禁分流（阈值来自站点设置，`packages/quality-rules/src/semantic/decision.ts:126-165`）：

```mermaid
flowchart TB
    subgraph MULTI["一稿多发：内容相同，多个站都要"]
        X1["文章 X<br/>发布站点：NKMed、Dianordic、Aixllent"]
        O1["nkmed.org/articles/...<br/>自引用 canonical"]
        O2["dianordic.com/articles/...<br/>自引用 canonical"]
        O3["aixllent.cn/articles/...<br/>自引用 canonical"]
        X1 --> O1
        X1 --> O2
        X1 --> O3
        NOTE1["同一篇文章不和自己比较<br/>不受跨站门禁影响"]
        X1 -.- NOTE1
    end

    subgraph COPY["品牌版本：针对某个品牌差异化"]
        X2["文章 X"] -->|"复制为新草稿<br/>选择目标站点"| Y["副本 Y<br/>记录复制来源 X"]
        Y --> RW["改写"] --> G{"跨站语义门禁<br/>Y 与 X 的内容相似度"}
        G -->|"达到 0.92"| BLK["阻断<br/>提示：内容无需差异化时<br/>请在 X 上追加发布站点"]
        G -->|"0.85 到 0.92"| RVW["审核人确认<br/>两篇确实不同"]
        G -->|"低于 0.85"| PASS["通过<br/>发布到目标站"]
    end

    style Y stroke-dasharray: 5 5
    style BLK stroke-dasharray: 5 5
```

**门禁拦下轻改的副本是期望行为**：只改几个字的副本在搜索引擎眼里和原文是同一篇，发出去拿不到额外排名，这种情况应当走"追加站点"。阈值可以在站点设置里按站调整。图中虚线部分是待改进的复制流程：复制时直接选目标站点（现在副本原样带走原文的站点分配，`edition-ops.ts:102-103`）、记录复制来源、阻断提示改为中文并给出下一步（现在是英文技术语句，`decision.ts:135`）。

**自引用 canonical**（canonical 指向页面自己）是 Google 官方推荐的做法，而且不表达任何主从关系。编译器现在生成的就是这种（`packages/compiler/src/seo/urls.ts:25-34`）。内容相同时，搜索引擎对同一查询通常只展示其中一个站点的版本，这是一稿多发的已知代价。

**作者按站解析**：文章作者（`content_editions.author_id`，真人，可空）> 站点机构作者（`sites.default_author_id`）> 合成的 `{站点名} Editorial Team`。一稿多发时文章作者留空，就自动取各站自己的机构作者，不会出现一个品牌的编辑部署名在另一个品牌的页面上。

---

## 5. 站点目录树

分类目前只是 `primary_topic` / `secondary_topics` 两个自由文本字段在编译期的投影（`apps/cms/src/services/compile-snapshot-mappers.ts:149-181`），没有独立实体、层级、排序和停用。

```mermaid
erDiagram
    sites ||--o{ site_categories : "拥有目录树"
    site_categories ||--o{ site_categories : "parent_id 自引用"
    site_categories ||--o{ edition_categories : "归类"
    content_editions ||--o{ edition_categories : "归属"
    content_editions ||--o{ edition_sites : "发到哪些站"
    sites ||--o{ edition_sites : "收录哪些文章"
    content_editions ||--o{ content_editions : "copied_from 复制来源"
    authors ||--o{ content_editions : "真人作者"
    authors ||--o{ sites : "站点默认机构作者"

    site_categories {
        int id PK
        int tenant_id
        int site_id
        int parent_id "顶层为 NULL"
        string slug
        string name
        string path "物化路径，(site_id, path) 唯一"
        int depth "上限 4"
        int sort_order "同级排序，拖拽写入"
        string status "active / hidden"
    }

    edition_categories {
        int id PK
        int edition_id
        int site_id "同一篇在不同站点可归不同目录"
        int category_id
        bool is_primary "每站至多一个，部分唯一索引"
    }

    edition_sites {
        int id PK
        int edition_id
        int site_id "(edition_id, site_id) 唯一"
        string publish_state "pending / published / failed / unpublished"
        int url_record_id "该站预留的 URL"
        string release_id "该站最近一次包含它的 release"
    }

    authors {
        int id PK
        int tenant_id
        string name
        string slug "作者页 /authors/slug"
        string credentials "jsonb 资质"
    }
```

**`edition_categories` 带 `site_id` 是目录设计里最重要的一条**：一稿多发时，同一篇文章（内容相同）可以在 NKMed 归到「肿瘤」、在 Dianordic 归到「健康科普」，两个站的目录树互不影响。

**唯一约束只保留 `(site_id, path)`**：若用 `(site_id, parent_id, slug)`，PostgreSQL 对顶层目录（`parent_id` 为 NULL）不生效，而且 path 唯一已完全覆盖它。仓库不建物理外键，"目录属于该站"与"该站是文章的发布站点"在应用层写入时校验。

**与编译的衔接**：编译器的列表页改为从目录树生成，同时产出面包屑与 BreadcrumbList 结构化数据；主题词派生列表页停用，已发布的主题词分类页经 `url_records` 转 301。

### 目录与 URL

```mermaid
flowchart TB
    CFG["sites.article_path_template"]
    A["/articles/{slug}<br/>默认，与现状一致"]
    B["/{categoryPath}/{slug}<br/>目录写进 URL"]
    CFG --> A
    CFG --> B

    A --> R1["无需迁移<br/>目录只用于浏览和列表"]
    B --> R2["信息架构信号更强<br/>但要迁移既有 URL"]
    R2 --> RD["url_records 状态机<br/>旧路径 → 301 → 新路径"]

    style CFG stroke-dasharray: 5 5
    style B stroke-dasharray: 5 5
    style R2 stroke-dasharray: 5 5
    style RD stroke-dasharray: 5 5
```

默认保持 `/articles/{slug}`（当前硬编码在 `edition-workflow.ts:309` 与 `compile-snapshot.ts:168`）。`url_records` 已有 reserved / active / redirected / gone 的完整状态机，将来切换时旧路径自动转 301，这个选择可以推迟。

---

## 6. 分层交付：兼容任意站点类型

ADR-001 规定服务面不得依赖 CMS 与 PostgreSQL、不能回退到控制面查询。所以**所有对外交付都出自交付服务，交付服务只读已发布的 release**。CMS 里直读数据库的 `/api/delivery/*` 不作为对外合同：它会让站点的在线状态绑死在 CMS 上，而且读的是数据库当前状态，回滚对它无效。

```mermaid
flowchart TB
    SRC[("已发布 release<br/>对象存储")]
    HOST["交付服务<br/>createRuntime 宿主<br/>由 examples 示例宿主产品化"]
    SRC --> HOST

    HOST --> API["JSON 出口<br/>完整 SEO 载荷"]
    HOST --> HTML["HTML 出口<br/>render-react + 每站外壳"]

    subgraph L1["第 1 层：JSON + 站点自渲染"]
        API --> SDK["站点拉取 JSON<br/>用自己的模板渲染"]
        WH["发布事件 webhook"] --> ISR["触发 ISR / 按需重生成"]
        SDK --> S1["NKMed（Next.js）<br/>Dianordic（Nuxt3）"]
        ISR --> S1
    end

    subgraph L2["第 2 层：静态 HTML 投放"]
        HTML --> SNAP["发布时渲染成文件"]
        SNAP --> PUSH["写入站点可写根目录<br/>或对象存储静态托管"]
        PUSH --> S2["VM 上的 nginx<br/>S3 / OSS / COS 静态站"]
    end

    subgraph L3["第 3 层：子目录反向代理"]
        HTML --> PROXY["站点侧一条代理规则<br/>nginx / Ingress / CF Worker<br/>Vercel / Netlify"]
        PROXY --> S3["Aixllent（aixllent-website）<br/>WordPress / 第三方"]
    end

    subgraph L4["第 4 层：JS 嵌入（仅兜底）"]
        API --> JS["前端脚本渲染"]
        JS --> S4["⚠ 不可靠：Google 延迟渲染不保证<br/>Bing / 百度基本拿不到"]
    end

    style HOST stroke-dasharray: 5 5
    style API stroke-dasharray: 5 5
    style HTML stroke-dasharray: 5 5
    style WH stroke-dasharray: 5 5
    style SNAP stroke-dasharray: 5 5
    style PUSH stroke-dasharray: 5 5
    style PROXY stroke-dasharray: 5 5
    style JS stroke-dasharray: 5 5
```

| 层 | 站点要求 | SEO | 站点侧工作量 | 适用 |
| --- | --- | --- | --- | --- |
| 1 JSON + 自渲染 | 有 SSR/SSG | 最好，站点完全控制 | 中：写页面模板 | NKMed、Dianordic |
| 2 静态投放 | 有可写站点根目录或对象存储静态托管 | 很好，纯静态 | 低到中：k8s 部署需改为挂卷 | VM nginx、对象存储静态站 |
| 3 子目录反代 | 能加一条路由规则 | 好，URL 在对方域名下 | 低：一条配置 + 外壳配置 | Aixllent、任意站点 |
| 4 JS 嵌入 | 能插一段脚本 | 不可靠 | 极低 | 仅兜底，不推荐 |

**Aixllent 为什么走第 3 层**：`aixllent.cn` 由 `aixllent-website` 提供（`aixllent-gitops-cn/ingress/root-ingress.yaml`），部署是 `nginx:alpine` 默认配置加一个 ConfigMap 形式的单页 `index.html`——只读挂载、总量上限 1 MiB，无法往里写文件。做法是给该 nginx 挂一份配置加 `location /articles/` 反代，或在 Ingress 层加路径规则（Traefik 的 Ingress 指向外部地址需开启 ExternalName 支持）。

**第 3 层的真实成本是外壳**：代理出去的页面由交付服务渲染，必须套用每站的页头、页脚与样式，否则与站点其余页面外观不一致。另外对方路径的可用性绑在交付服务上，代理层需要缓存与"过期仍可用"策略。

**站点也可以直接内嵌 `@geo/runtime`**（`examples/` 就是这种形态），同样符合 ADR-001；代价是要把对象存储读凭据分发到每个站点，所以默认走中心交付服务。

---

## 7. 发布事件与站点同步

发布完成后目前没有任何事件（事件表已在 `0003_drop_outbox.sql` 删除）。第 1 层依赖"发布后通知站点重新生成"，撤下站点依赖下线事件，所以需要一个轻量出站通知。沿用仓库既有模式：**在 CMS 的业务事务里同事务入队 pg-boss**，不恢复 outbox。

```mermaid
sequenceDiagram
    autonumber
    participant W as geo worker
    participant CMS as geo CMS
    participant DB as geo 数据库
    participant EP as 站点 webhook
    participant IDX as 搜索引擎

    W->>CMS: 某站 release 已发布<br/>POST /internal/sites/:id/releases/published
    CMS->>DB: 同一事务：release 转 current<br/>该站 URL 转 active<br/>edition_sites 该站转 published<br/>入队站点通知任务
    CMS-->>W: 200
    DB-->>W: pg-boss 投递通知任务
    W->>EP: POST 站点 webhook<br/>HMAC 签名 + 事件类型
    alt 站点返回 2xx
        EP->>EP: 触发 ISR / 重新构建
    else 失败
        W->>W: 指数退避重试，超限进死信
    end
    W->>IDX: IndexNow 提交变更 URL<br/>Bing / Yandex
```

事件类型至少区分 `published`、`updated`、`unpublished`。**下线事件不能省**：没有它，文章在 geo 归档或从某站撤下后，站点上会留下孤儿页，对医疗内容是事实错误。

**sitemap 与 IndexNow**：Google 的 sitemap ping 接口已于 2023 年下线，sitemap 只能通过 robots.txt 的 `Sitemap:` 指令与 Search Console 提交，图中不再有"提交 sitemap"一步。IndexNow 要求在站点域名下放密钥文件，且密钥文件所在目录决定可提交的 URL 范围：第 3 层可以把密钥文件放在代理路径下由 geo 自行提交，第 1 层需要站点配合放置。

---

## 8. 关键约束速查

| 约束 | 出处 | 影响 |
| --- | --- | --- |
| 发布链路只认单数 `site_id` | 第 2 节表格 | 一稿多发需先改造发布链路 |
| 已发布文章无法改站点分配 | `edition-ops.ts:45,197-199` | 需新增"追加 / 撤下站点"的按站操作 |
| 复制文章原样带走站点分配 | `edition-ops.ts:102-103` | 复制时应直接选目标站点 |
| 跨站内容相似度达 0.92 阻断，0.85 起需复核 | `packages/quality-rules/src/semantic/decision.ts:126-150` | 轻改的副本发不出去；内容相同应走一稿多发 |
| 一稿多发与品牌版本 | `product.md` 4.3、5.4（2026-09-23 修订） | 相同内容用一稿多发；差异化复制改写 |
| 服务面不得依赖 CMS 与 PostgreSQL | ADR-001 | 对外交付只能出自交付服务，`/api/delivery/*` 不作对外合同 |
| 质量除显式 passed 外一律阻断 | ADR-004 | 站点相关检查需按站跑 |
| 文章路径 `/articles/<slug>` 硬编码 | `edition-workflow.ts:309`、`compile-snapshot.ts:168` | 目录进 URL 需引入站点级模板 |
| URL 在 `approved` 时预留 | `edition-workflow.ts:395-402` | 改标题不会改已预留的路径 |
| 台账 canonical 带 locale 前缀 | `packages/domain/src/url/normalization.ts:200-215` | 与页面实际 canonical（`packages/compiler/src/seo/urls.ts:25-34`）不一致，需修正台账 |
| 请求体上限 1 MiB | `integration-guards.ts:40`、`internal/guards.ts:62` | crawl 回调采用瘦通知 |
| `connectors.secret_reference` 零引用 | `entity-schema.ts:82` | 出站凭据需补读取逻辑 |
| 交付限流取 `x-forwarded-for` 第一段 | `delivery.ts:48` | 在 Cloudflare 之后可伪造；改为站点密钥与配额 |
| 无物理外键 | 迁移约定 | 新表裸 integer 列 + 索引，关系在应用层校验 |
| 迁移编号 | `apps/cms/drizzle/`，最新 0011 | 新迁移从 0012 起，同步 `meta/_journal.json` |
