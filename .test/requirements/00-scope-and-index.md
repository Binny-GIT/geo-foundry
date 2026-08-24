# 00 测试范围与索引

## 系统概述

Geo Foundry 是一个多租户内容运营平台，分三层：

- **控制面 CMS**（`apps/cms`，Payload 3.88 + Next 16）：租户/站点/域名/内容/版本/URL/发布/回滚等集合，公开端点与零信任内部端点，服务层业务逻辑。
- **领域与编译**（`packages/domain`、`packages/compiler`、`packages/content-pipeline`、`packages/content-client`）：状态机、URL 注册表、编译器、内容生成/评估流水线、内部契约客户端。
- **执行/提交/服务面**（`apps/worker`、`apps/content-service`、`examples/site-a-next`、`examples/site-b-express`）：BullMQ 流水线、操作提交 HTTP 服务、S3 制品驱动的站点渲染。

## 模块索引

| 文档 | 区域码 | 覆盖 |
| --- | --- | --- |
| `10-cms-collections.md` | COL | 14 个 Payload 集合的 CRUD、字段校验、钩子、关系、上传 |
| `11-cms-access-rbac.md` | RBAC | 角色×资源×动作策略矩阵、会话claims、租户隔离、越权防护 |
| `12-cms-internal-endpoints.md` | INT | 17 个内部零信任端点 + `withInternalGuards` 守卫与错误码映射 |
| `13-cms-public-endpoints.md` | API | 回滚意图/版本工作流/URL 改名公开端点、健康、就绪、后台、首页 |
| `14-cms-services.md` | SVC | 编译快照、版本工作流、嵌入、操作账本、发布注册、回滚、URL 注册、outbox |
| `20-domain.md` | DOM | 内容/发布/操作/质量/URL 状态机、URL 注册表、不变量、站点host解析 |
| `30-compiler.md` | CMP | compileSite、blocks/pages、路由索引、分页、SEO、sitemap、结构化数据、确定性 |
| `40-content-pipeline.md` | CPL | 草稿/生成/评估流水线、LLM 评估、语义检查、providers |
| `50-content-client-contract.md` | CLI | ContentServiceClient 17 操作、zod 契约、错误映射 |
| `60-worker-and-content-service.md` | WRK/CSVC | 队列/流程、处理器、发布流水线、reconcile、content-service HTTP API |
| `70-example-sites.md` | SITE | site-a/site-b 路由状态矩阵、S3 制品、sitemap、release-id 头 |
| `80-deploy-ops.md` | OPS | Docker/compose、冒烟、迁移策略、镜像构建、工具链门禁 |
| `90-cross-cutting.md` | XC | 确定性、审计不可变、错误码契约、可访问性、响应式、性能基线 |
| `execution-matrix.md` | — | 全量用例状态账本（权威） |

## 最近变更与测试重点（2026-08-22）

1. **公开首页替换跳转**：`/` 由 `redirect("/admin")` 改为 `(public)` 路由组静态入口页；`(payload)` 保留 Payload 自有 `<html>` 布局。→ 重点 `API-*` 首页/后台并存。
2. **生产构建切 webpack + import map 修复**：`next build --webpack`；构建前置 `payload generate:importmap`，并在 `payload.config.ts` 指定 `importMapFile` 为 `importMap.ts`，修复 `S3ClientUploadHandler` 缺失导致的 Admin 登录页空白。→ 重点 `API-*` Admin 渲染、`OPS-*` 构建产物含完整 import map。
3. **浏览器验收改真断言**：`browser-checks.mjs` 现要求首页主标题可见、`/admin/login` 邮箱+密码框可见，否则失败。

## 覆盖策略

- **已有自动化**（`vitest.workspace.ts` 13 项目、Playwright、`tests/faults`、`tooling/*`、集成套件）作为基线，本需求库标注 `已有自动化` 的用例默认可映射到对应 `*.test.ts`。
- **手工/半自动**用例（UI、公网、跨服务时序、回归）在证据列人工回写。
- 每个功能"尽可能细"意味着：集合到字段级校验与每条 access 分支；端点到每个错误码分支；状态机到每条合法边与非法边；编译器到每种页面类型与 SEO/sitemap 断言。
