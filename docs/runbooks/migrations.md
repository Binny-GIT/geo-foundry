# Runbook：CMS migration

## 原则

数据库 schema 只能通过已提交 migration 演进。不要使用 database push，不要在 CI 或生产环境生成 migration。

## 状态与执行

在批准的共享服务环境中：

```sh
pnpm --filter @geo/cms db:migrate:status
pnpm --filter @geo/cms db:migrate
```

`db:migrate` 先检查 migration index，再经 `apps/cms/scripts/secure-run.mjs` 启动 Payload migration。它只读取 owner-only 凭据文件引用；失败输出稳定代码，不输出凭据。

## 创建 migration

仅在本地开发、schema 改动已评审且不在 CI 时创建。使用受控 CMS migration 脚本，并将生成的 TypeScript、snapshot 与 index 一起审核、提交。不要在受保护 runner 或部署环境中执行 schema generation。

## 故障处理

- `CMS_CHECKED_IN_MIGRATION_MISSING`：恢复或提交 migration index 后再执行。
- `CMS_MIGRATION_GENERATION_FORBIDDEN`：不要绕过 CI/production guard；在本地开发环境生成并评审 migration。
- secure runner 凭据错误：修复 `*_FILE` owner/mode，不要复制值到环境或日志。
