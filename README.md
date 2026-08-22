# Geo Foundry

Geo Foundry 是一个受治理的 Node.js 24 ESM monorepo：控制面管理租户、编辑版本、异步操作与发布审计；服务面只从不可变对象存储解析并渲染已发布的站点内容。

## Toolchain

- Node.js `24.18.0`（支持范围见根 `package.json`）
- pnpm `11.22.0`
- Turborepo `2.10.10`
- TypeScript `5.9.3`
- Biome `2.5.8`

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm verify:toolchain
pnpm ci:verify
```

`pnpm ci:verify` 是不需要 PostgreSQL、Redis、RustFS、CMS 凭据或浏览器服务的公共验证入口。它关闭 Turbo remote cache，执行格式、lint、类型、单元/合同、双进程编译确定性、rollback smoke、构建、包边界检查和经 receipt 绑定的 evidence 验证。

## 架构边界

- **控制面**：`apps/cms`、`apps/content-service`、`apps/worker`。负责认证、租户范围、编辑状态机、幂等 operation ledger、质量证据、发布和回滚请求。
- **服务面**：`packages/runtime` 与 Site A/Site B SSR hosts。它们只读取 routing、current pointer、release manifest、页面 JSON 与 sitemap；不连接 CMS、PostgreSQL、Redis、BullMQ 或 LLM provider。
- **包**：`packages/` 中的公开包仅发布 `dist/` 和 `package.json`，且必须通过已声明 export 使用；禁止深层源码导入。

更详细的设计决定位于 [`docs/adr/`](docs/adr/)，外部消费者接入见 [`docs/package-integration.md`](docs/package-integration.md)。

## 常用验证命令

| 目的 | 命令 |
| --- | --- |
| 格式、lint、类型、测试与公开 API | `pnpm check` |
| 不需要共享服务的 CI gate | `pnpm ci:verify` |
| 故障合同与 fail-closed 回归 | `pnpm test:faults:contracts` |
| 共享服务连通性与 namespace 所有权检查 | `pnpm shared:check -- --run-id <lowercase-run-id>` |
| 有界清理同一 namespace | `pnpm shared:cleanup -- --run-id <same-run-id>` |
| 固定双站点 MVP seed / scenario | `pnpm mvp:seed`、`pnpm mvp:run` |
| 生产构建的双站点浏览器验收 | `pnpm test:e2e` |
| opt-in 真实故障矩阵 | `GEO_FOUNDRY_FAULTS_ENABLED=true pnpm test:faults` |
| 包边界与 tarball consumer smoke | `pnpm packages:validate`、`pnpm packages:pack-smoke` |

`test:e2e` 和 `test:faults` 只应在批准的共享服务环境运行。它们要求 loopback endpoint、owner-only 的 `*_FILE` 凭据引用和本次 run 专属 namespace；公共 CI 不运行这些命令。

## 凭据与共享服务

仓库、镜像、日志、evidence 与文档都不得包含凭据值。只传递 owner-only 文件路径，例如：

```text
GEO_FOUNDRY_PG_USER_FILE=/approved/path/pg-user
GEO_FOUNDRY_PG_PASSWORD_FILE=/approved/path/pg-password
GEO_FOUNDRY_REDIS_PASSWORD_FILE=/approved/path/redis-password
GEO_FOUNDRY_S3_ACCESS_KEY_FILE=/approved/path/s3-access-key
GEO_FOUNDRY_S3_SECRET_KEY_FILE=/approved/path/s3-secret-key
```

`pnpm shared:check` 与 `pnpm shared:cleanup` 使用既有 secure runner：它验证文件属于当前用户且没有 group/other 权限，然后仅将值注入子进程。每个 run ID 只能操作自己的 PostgreSQL probe table、Redis key、S3 `objects/<run-id>/` 对象和 manifest；禁止 `FLUSHDB`、bucket-wide list 与共享服务重配。

操作步骤与事故处置请参阅 [`docs/runbooks/`](docs/runbooks/)。

## PRD 输入

上游提供的 PRD 应保存为 `mydocs/260817-geo-foundry-PRD.md`。`mydocs/` 是本地、受控输入目录并被 Git 忽略，因此不要复制、改写或在提交中伪造其内容；实现与验收约束由本仓库的开发计划和 ADR 交叉引用。
