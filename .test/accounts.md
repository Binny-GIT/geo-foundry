# 测试账号与凭据引用

> **安全约定（务必遵守）**：本文件受 Git 跟踪，**只记录非机密标识与凭据文件路径，严禁写入任何密码/密钥/Secret 明文**。所有口令、数据库/S3/Redis 凭据、PAYLOAD_SECRET、API Key 一律存放在属主专用文件（mode 600、属主本人），运行时经安全包装器注入进程环境，绝不进入仓库或镜像。

## 账号来源与适用范围

- MVP 角色账号由种子脚本 `apps/cms/scripts/mvp-seed.mjs` 依据 `tests/fixtures/mvp/scenario.json` 创建，**仅在 `GEO_FOUNDRY_CMS_CONFIG_MODE=integration-test` 下运行**（集成测试库 `geo_foundry_cms_integration`）。
- **mk-dev 公网环境（`geo-foundry-mk-dev.aixllent.com`）未 seed `mvp-*` 账号**，但存量有 7 个 `embed-*` 账号（见下"mk-dev 现存账号"，2026-08-20 由集成测试助手 `apps/cms/test/integration/helpers/embeddings-world.ts` 直接写入 mk-dev 生产库创建）。
- 首用户引导机制：`apps/cms/src/collections/Users.ts` 的 create 访问规则——当 users 表为 0 行时允许一次匿名创建 super-admin，之后匿名创建全部拒绝。非 `payload create-first-user`、非迁移、非环境变量硬编码。

## MVP 角色账号（非机密标识）

租户：`geo-foundry-mvp`。密码：所有种子用户共用同一口令，取自安全文件 `GEO_FOUNDRY_MVP_TEST_PASSWORD_FILE`（属主专用、最少 12 位）；**仓库无任何硬编码/已知口令**。

| 角色 | 邮箱 | CMS role | 用途 |
| --- | --- | --- | --- |
| 超级管理员 | `mvp-boot@geo-foundry.test` | `super-admin` | 首用户引导；跨租户读、管理 tenants/users |
| 租户管理员 | `mvp-tenant-admin@geo-foundry.test` | `tenant-admin` | 本租户内管理 users/sites/domains |
| 编辑 | `mvp-editor@geo-foundry.test` | `editor` | 创建/更新 contents/editions/media |
| 审阅 | `mvp-reviewer@geo-foundry.test` | `reviewer` | 只读 + 工作流审阅（approve/reject 走 transition 端点） |
| 发布 | `mvp-publisher@geo-foundry.test` | `publisher` | 发布/回滚（走工作流端点，非集合写） |
| 内容服务 | `mvp-content-service@geo-foundry.test` | `content-service` | 服务身份；仅写 editions + 建 assessments |

登录接口：`POST /api/users/login`（后台 UI 亦可）。邮箱域 `@geo-foundry.test`、站点域 `.test` 均为保留测试域，非真实资产。

## mk-dev 现存账号（embed-*，浏览器/UI 测试用）

由 `apps/cms/test/integration/helpers/embeddings-world.ts` 于 2026-08-20 直接写入 mk-dev 生产库创建；**口令为仓库内固定测试口令**（同一文件内，`embeddings-world.ts` 各 `password` 字面量），本表不重复抄录。浏览器回归脚本 `browser-admin-tests.mjs` 不保存口令，运行时需要从受控环境传入 `GEO_FOUNDRY_BROWSER_{SUPER_ADMIN,EDITOR,TENANT_ADMIN,FOREIGN_ADMIN}_PASSWORD`；测试执行器可从该 helper 读取后仅在进程内注入。租户：`embed-tenant`（本租户）与一个 foreign 租户。

| 角色 | 邮箱 | CMS role | 租户 | 用途 |
| --- | --- | --- | --- | --- |
| 超级管理员 | `embed-boot@geo-foundry.test` | `super-admin` | — | 后台 UI 全量测试（全集合可读） |
| 租户管理员 | `embed-tenant-admin@geo-foundry.test` | `tenant-admin` | embed-tenant | 租户内 users/sites/domains 管理 |
| 外部租户管理员 | `embed-foreign-admin@geo-foundry.test` | `tenant-admin` | foreign | 跨租户隔离对照 |
| 编辑 | `embed-editor@geo-foundry.test` | `editor` | embed-tenant | 内容读写、越权对照（users/tenants 应拒） |
| 外部租户编辑 | `embed-foreign-editor@geo-foundry.test` | `editor` | foreign | 跨租户隔离对照 |
| 内容服务 | `embed-service@geo-foundry.test` | `content-service` | embed-tenant | 服务身份（API Key 登录，UI 非主路径） |
| 外部租户内容服务 | `embed-foreign-service@geo-foundry.test` | `content-service` | foreign | 跨租户隔离对照 |

> ⚠️ 这些固定口令随仓库代码可见，仅适用于测试域账号；若 mk-dev 升级为更受控环境，须轮换其口令并清理本表引用。

## 站点与域名（非机密）

| 站点 key | 名称 | canonical 域 | 别名域 |
| --- | --- | --- | --- |
| site-a | Site A Engineering | `site-a.test` | `www.site-a.test` |
| site-b | Site B Operations | `site-b.test` | `www.site-b.test` |

## 角色权限速查

权威见 `apps/cms/src/access/policy.ts`。资源：tenants/users/sites/domains/contents/editions/media/url-records/operations/assessments/releases；动作 CRUD；deny-by-default，delete 对所有角色/资源均为 false。

- **super-admin**：跨租户只读全部；create/update tenants、users；内容资源只读。`readScope=true`（无限制）。
- **tenant-admin**：单租户内 create/update users/sites/domains；tenants 与内容只读。
- **editor**：create/update contents/editions/media；sites/domains/url-records/operations/assessments 只读。
- **reviewer**：可见范围只读；审批经工作流 transition，非 CRUD。
- **publisher**：内容/releases/url-records 只读；发布/回滚经工作流端点。
- **content-service**（服务身份）：仅 create/update editions、create assessments；读 sites/contents/editions；无 users/tenants/media/url-records。

## 服务身份与 API Key（引用，不含明文）

- 服务身份判定：`requireServiceIdentity`（`apps/cms/src/services/edition-workflow.ts`）要求 `claims.kind="service"` 且 `claims.role="content-service"`。
- `CONTENT_SERVICE_API_KEY`：content-service 以 content-service 用户身份调用 CMS 的 Bearer 凭据（`packages/content-client` 发送 `authorization: Bearer <key>`）。配置于 env 或 `CONTENT_SERVICE_API_KEY_FILE`（属主专用）。
- `CONTENT_SERVICE_OPERATOR_API_KEY`：调用 content-service 自身 HTTP API 的入站 Bearer 凭据（`apps/content-service/src/main.ts`）。配置于 env 或 `<NAME>_FILE`；MVP 编排脚本用每轮随机 `crypto.randomUUID()`。
- Users 集合 `auth.useAPIKey: true`：支持 Payload 静态 API Key 作为替代。

## 凭据文件路径（只列位置，不列值）

### 本地开发（安全包装器 `~/.local/bin/geo-foundry-cms-secure`）

| 凭据 | 文件路径 | 说明 |
| --- | --- | --- |
| PAYLOAD_SECRET | `~/.local/state/geo-foundry-cms/payload-secret` | 缺失时 `openssl rand -hex 32` 自动生成，600 |
| Redis 密码 | `~/.local/state/geo-foundry-cms/redis-password` | 600 |
| S3/RustFS access key | `~/.config/rustfs/geo-service-access-key` | 默认路径 |
| S3/RustFS secret key | `~/.config/rustfs/geo-service-secret-key` | 默认路径 |
| Postgres 用户/口令 | 运行时从 `/home/ubuntu/my-docker-service/pg/docker-compose.yml` 解析到 mktemp（600） | 不落仓库 |
| MVP 种子/登录口令 | `GEO_FOUNDRY_MVP_TEST_PASSWORD_FILE` 指向的属主专用文件 | 最少 12 位 |

安全包装器 `apps/cms/scripts/secure-run.mjs` 校验每个 `*_FILE` 为属主专用（`mode & 0o077 === 0` 且 `uid` 匹配）后，才把值注入白名单命令（`next dev/start`、reset-integration、mvp-seed、`payload migrate`、`vitest run`）。非机密引用戳：`GEO_FOUNDRY_PG_SECRET_REF=pg-server-mk-dev-existing-auth`、`GEO_FOUNDRY_S3_SECRET_REF=rustfs-geo-foundry-svc`。

### mk-dev 容器部署

- 全部凭据在 `/opt/geo-foundry/mk-dev.env`（root:root 600），经 `docker compose --env-file` 注入。详见 `my-deploy/mk-dev.md`。
- `deploy/env.example` 仅含变量名与 `example-*` 占位；`deploy/smoke/verify.env` 为一次性 verify 栈的 `*-placeholder` 假值；根 `.env.example` 只记变量名并警告"不得写入凭据值"。

## 固定非机密运行参数

- 本地：PG `127.0.0.1:5432`、DB/schema `geo_foundry`、Redis `127.0.0.1:6379/0`、S3 `127.0.0.1:9000`（path-style、无 SSL）。
- mk-dev：PG 别名 `pg-server:5432`、S3 别名 `rustfs-server:9000`、CMS 容器 `127.0.0.1:3090`、content-service 回环 `127.0.0.1:3100`。
- 公网入口：`https://geo-foundry-mk-dev.aixllent.com`（Cloudflare 共享隧道）。

## 使用提示

- 集成/E2E 前先确保安全文件就位并 seed：`GEO_FOUNDRY_CMS_CONFIG_MODE=integration-test pnpm mvp:seed`（经安全包装器）。
- mk-dev 后台首次登录前需先完成首用户引导创建 super-admin（users 表为空时的一次匿名创建）。
- 任何新增测试账号：更新本表的邮箱/角色标识即可，**口令仍只进安全文件**。
- **CMS REST API 的 Bearer 头必须含 `Bearer ` 前缀**（`Authorization: Bearer <jwt>`）；
  漏写前缀时 Payload 按匿名处理，受保护资源返回 **403 而非 401**（260822 浏览器测试排查中确认，
  见 `extractJWT` 的 `startsWith("Bearer ")` 判定）。
