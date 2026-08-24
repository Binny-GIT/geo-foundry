# 80 部署 / 运维 / 迁移（OPS）

覆盖 `deploy/*`、`Makefile`、`apps/cms/src/migrations/*`、`config/*`、`scripts/*`。mk-dev 运行手册见 `my-deploy/mk-dev.md`。

## 镜像构建与产物

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | OPS-P0-001 | P0 | `deploy/image-build-mkdev.sh <tag>` | 生成镜像、standalone 含 server.js | `.next/static` 已拷入 | 260822 已用于 admin 修复 |
| [ ] | OPS-P0-002 | P0 | 生产构建走 webpack + 前置 generate:importmap | 构建产物 import map 含 S3ClientUploadHandler | 无缺失组件日志 | 关联 API-P0-051 |
| [ ] | OPS-P1-003 | P1 | 构建产物路由含 `/` 与 `/admin` | route 表正确 | — | 260822 PASS |

## Compose / 容器冒烟

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | OPS-P0-010 | P0 | `make container-smoke`（verify 栈） | 容器起+`/api/health` alive | 清理容器 | NOT_RUN |
| [ ] | OPS-P0-011 | P0 | `make deploy-mk-dev` | up --wait + 本机/公网 smoke | 容器 healthy | 260822 已执行 |
| [ ] | OPS-P0-012 | P0 | `make rollback-mk-dev` 改 IMAGE_TAG 回滚 | 旧镜像恢复 healthy | watchtower 恢复 | NOT_RUN |
| [ ] | OPS-P1-013 | P1 | `deploy/smoke/smoke.sh` 本机+公网 health | 均 alive | — | NOT_RUN |
| [ ] | OPS-P1-014 | P1 | compose config 校验（-q） | 无配置错误 | env 完整 | NOT_RUN |
| [ ] | OPS-P2-015 | P2 | 公网 `browser-checks.mjs` 7/7 | 全通过 | 首页+admin+API | 260822 PASS 7/7 |

## 迁移

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | OPS-P0-020 | P0 | 迁移策略：禁 create DB、push:false、prod migrations | 适配器强制 | database.test 已覆盖 | database |
| [ ] | OPS-P0-021 | P0 | `pnpm --filter @geo/cms db:migrate` 幂等 | 重跑无副作用 | 14 套迁移有序 | NOT_RUN |
| [ ] | OPS-P1-022 | P1 | expand-only 破坏性迁移窗口约束 | 契约迁移待回滚窗口关闭 | 手册约束 | NOT_RUN |

## 配置校验

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | OPS-P0-030 | P0 | `parseCmsEnvironment` 缺变量 | `CmsEnvironmentError` 列出缺失 | 集成 shared-services | environment |
| [ ] | OPS-P0-031 | P0 | PAYLOAD_SECRET < 32 | 拒绝 | — | NOT_RUN |
| [ ] | OPS-P0-032 | P0 | 模式 runtime/build/integration-test 行为差异 | build 模式用占位、runtime 用真实凭据 | — | environment |
| [ ] | OPS-P0-033 | P0 | `parseSharedServicesEnvironment` PG/Redis/S3 字面量校验 | 非法值 `SharedServicesEnvironmentError` | — | shared-services |
| [ ] | OPS-P1-034 | P1 | 安全运行包装器 secure-run 凭据文件权限/缺失 | 校验拒绝（600/属主） | — | NOT_RUN |

## 工具链门禁

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | OPS-P1-040 | P1 | `make check-toolchain`（Node 24 + pnpm 11.22.0） | 版本不符即报错 | toolchain.test | toolchain |
| [ ] | OPS-P1-041 | P1 | CI 脚本 verify/lint-changed/format-changed/repository-safety | 各自门禁生效 | — | ci-contract |
| [ ] | OPS-P1-042 | P1 | 共享服务测试隔离（lock/cleanup/check） | 并发测试不互扰 | shared-service-lock | NOT_RUN |
| [ ] | OPS-P2-043 | P2 | 证据门 `scripts/evidence/*` | 证据齐备才通过 | evidence-hardening | NOT_RUN |
| [ ] | OPS-P2-044 | P2 | 文档契约 documentation-contract | 文档与实现一致 | — | NOT_RUN |
