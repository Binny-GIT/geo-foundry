# 70 示例站点 site-a / site-b（SITE）

覆盖 `examples/site-a-next`（Next 运行时）与 `examples/site-b-express`（Express 运行时）。两者从 S3/RustFS 读取预编译制品，按 `{hostname, pathname}` 解析页面。**不直接调用 CMS API。** 已有自动化：各自 `scripts/*-integration.mjs`、`test/architecture.test.mjs`、根 `tests/e2e/public-sites.spec.mjs`（Playwright，4 项目：site-a/b × desktop/mobile，含视觉快照）。

## 路由状态矩阵（site-a，集成脚本断言）

对每个站点重复执行。列为期望 HTTP 状态。

| 已测 | ID | 优先级 | 路由/场景 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SITE-P0-001 | P0 | 文章页 | 200，正确 HTML + JSON-LD | `x-geo-release-id` 存在 | site-a-integration |
| [ ] | SITE-P0-002 | P0 | 列表页 | 200 | 分页正确 | NOT_RUN |
| [ ] | SITE-P1-003 | P1 | guides 页 | 200 | — | NOT_RUN |
| [ ] | SITE-P1-004 | P1 | tags 页 | 200 | — | NOT_RUN |
| [ ] | SITE-P1-005 | P1 | 别名 host | 200（解析到规范站点） | host 解析正确 | 关联 DOM host |
| [ ] | SITE-P0-006 | P0 | `/missing` 未知路径 | 404 | — | NOT_RUN |
| [ ] | SITE-P0-007 | P0 | `/old-site-a` 旧路径 | 301 跳转 | 目标正确 | 关联 URL registry |
| [ ] | SITE-P0-008 | P0 | `/gone` 已删除 | 410 | — | NOT_RUN |
| [ ] | SITE-P0-009 | P0 | 未知 host | 404 | — | NOT_RUN |
| [ ] | SITE-P1-010 | P1 | `/sitemap.xml` | 200 合法 XML | 与编译 sitemap 一致 | 关联 CMP |

## 制品与运行时

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SITE-P0-020 | P0 | S3 reader 读取发布制品 | 命中当前 release | release-id 与注册一致 | s3-reader |
| [ ] | SITE-P0-021 | P0 | 回滚后站点读到旧 release | 内容回退 | `x-geo-release-id` 变更 | 关联 SVC 回滚 |
| [ ] | SITE-P1-022 | P1 | site-b `verify-build` 构建校验 | 通过 | — | site-b |
| [ ] | SITE-P1-023 | P1 | 模块边界架构测试 | 无越界依赖 | architecture.test | architecture |
| [ ] | SITE-P2-024 | P2 | 服务面隔离（serving-plane-isolation） | 站点间/租户间不串 | runtime integration | NOT_RUN |

## UI/视觉（Playwright e2e）

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | SITE-P1-030 | P1 | site-a/b desktop 渲染 | 视觉快照匹配 | 无 console error | public-sites.spec |
| [ ] | SITE-P1-031 | P1 | site-a/b mobile 渲染 | 视觉快照匹配 | 响应式正确 | public-sites.spec |
| [ ] | SITE-P2-032 | P2 | 负向契约 negative-contracts | 非法输入被拒 | — | tests/e2e |
