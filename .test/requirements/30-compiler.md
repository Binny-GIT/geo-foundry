# 30 编译器（CMP）

覆盖 `packages/compiler/src/*`。入口 `compileSite(request): CompileOutput`。纯函数、要求确定性。已有自动化：compiler(golden)、determinism、golden、reject、routes、seo、sitemap、structured-data、two-sites。以 `PASS_BACKEND` 计。

## compileSite 主流程

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CMP-P0-001 | P0 | 输入 site+editions+listings 正常 | 返回 CompiledDocument[]、route index、sitemap、结构化数据 | 文档按 pathname 排序 | golden |
| [ ] | CMP-P0-002 | P0 | 相同输入二次编译 | 字节级一致 | `canonicalJson`+`sha256Hex` 相同 | determinism |
| [ ] | CMP-P0-003 | P0 | 不可编译 edition（缺字段/日期逆序/非 canonical 域） | 典型拒绝 `CompilerError` | 相应 `COMPILER_ERROR` 码 | reject |

## 页面/区块编译

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CMP-P1-010 | P1 | `compileArticle` 文章页 | 结构/hero/SEO 正确 | golden 快照一致 | golden |
| [ ] | CMP-P1-011 | P1 | `compileListingPage` 列表页 | 分页/条目正确 | — | golden |
| [ ] | CMP-P1-012 | P1 | `compileNotFoundPage` 404 页 | 生成 | — | special-pages |
| [ ] | CMP-P1-013 | P1 | `compileRedirectPage` 跳转页 | 目标正确 | — | special-pages |
| [ ] | CMP-P1-014 | P1 | `compileBlocks` 各区块类型 | 逐类型渲染 | 12 种 PAGE_DOCUMENT_BLOCKS | 关联 CMS editor |
| [ ] | CMP-P1-015 | P1 | 快照校验 `assertEditionCompilable`/`assertDateOrder`/`assertEditionOnCanonicalDomain`/`requireUtcInstant` | 违规抛错 | — | NOT_RUN |

## 路由与分页

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CMP-P0-020 | P0 | `buildRouteIndex`/`objectKeyOf`/RouteStatus | 索引与对象键正确 | — | routes |
| [ ] | CMP-P1-021 | P1 | `paginateListing`/`listingPagePathname` | 分页路径正确 | — | sitemap/routes |
| [ ] | CMP-P1-022 | P1 | `assertPageInRange` 越界页 | 拒绝 | — | NOT_RUN |
| [ ] | CMP-P1-023 | P1 | `buildRoutingManifest`/`siteIdOfHost` | 清单+host→siteId 正确 | — | 关联 SITE/worker |

## SEO / sitemap / 结构化数据

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CMP-P0-030 | P0 | `buildSeo`/`verifySeoConsistency` | 元数据一致 | canonical 与域一致 | seo |
| [ ] | CMP-P0-031 | P0 | canonical/asset/redirect URL 生成 + canonical-domain 断言 | 正确、跨域拒绝 | — | seo |
| [ ] | CMP-P1-032 | P1 | `buildSitemapXml` | 合法 XML、含合规 URL | 与 url registry 一致 | sitemap |
| [ ] | CMP-P1-033 | P1 | 结构化数据 JSON-LD（article/listing/webpage 图，去重） | 图正确、无重复节点 | — | structured-data |
| [ ] | CMP-P2-034 | P2 | 双站点隔离编译 two-sites | 站点间不串数据 | — | two-sites |
