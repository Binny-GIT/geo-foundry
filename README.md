# Geo Foundry

Geo Foundry 是 Xllent AI、Dianordic、NKMed 等自有品牌共用的**内容运营后台**。

各种来源的文章统一进入这里，由运营人员完成筛选、编辑、来源核对、品牌改写、审核、排期和发布，用于品牌的电子化推广。

```text
稿源进入 → 筛选 → 编辑 → 来源核对 → 品牌版本 → 审核 → 排期 → 发布 → 更新
```

已发布的网站只读取不可变的发布产物，因此后台故障时站点仍可正常访问。

## 文档

| 文档 | 内容 |
| --- | --- |
| [产品说明](docs/product.md) | 产品定位、用户、业务流程、界面信息架构、范围 |
| [架构说明](docs/architecture.md) | 技术栈、模块边界、数据模型、明确不采用的技术 |
| [开发计划](docs/development-plan.md) | 阶段划分与验收标准 |
| [运行手册](docs/operations.md) | 部署、迁移、发布、回滚、任务恢复、事故处理 |
| [架构决策记录](docs/adr/) | 关键决策及其理由 |

产品方向以 [`docs/product.md`](docs/product.md) 为准。上游《多站点 AI GEO 内容发布平台 PRD》是需求输入，不是实现合同。

## 技术栈

- Node.js 24、pnpm、TypeScript、Turborepo、Biome
- Next.js 16 App Router、React 19、Tailwind CSS 4、Radix UI
- Payload 3.88 作为后端底座：数据、认证、权限、租户范围、媒体、版本、迁移
- PostgreSQL 作为唯一事实源
- BullMQ 与共享 Redis 执行后台任务
- S3 兼容对象存储保存媒体、稿源快照与发布产物
- Lexical 编辑结构化正文，Zod 做运行时校验

选型取舍与明确不采用的技术见[架构说明](docs/architecture.md)。

## 目录结构

```text
apps/cms          控制台与控制面接口
apps/worker       后台任务
packages/         内部包：schema、domain、compiler、publisher、runtime、render、quality-rules 等
examples/         多站点隔离测试用的示例站点，不是产品的一部分
deploy/           容器编排
docs/             产品与架构文档
```

`packages/` 下的包都是内部包，不对外发布。

## 本地开发

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm verify:toolchain
pnpm ci:verify
```

`pnpm ci:verify` 是不需要数据库、Redis、对象存储或浏览器服务的公共验证入口。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 格式、lint、类型与测试 | `pnpm check` |
| 不需要共享服务的验证 | `pnpm ci:verify` |
| 发布与回滚契约回归 | `pnpm test:faults:contracts` |
| 共享服务连通性检查 | `pnpm shared:check -- --run-id <run-id>` |
| 清理本次运行的命名空间 | `pnpm shared:cleanup -- --run-id <run-id>` |
| 多站点浏览器验收 | `pnpm test:e2e` |

需要共享服务的命令只在批准环境执行，公共 CI 不运行它们。

## 凭据

仓库、镜像、日志和文档都不得包含凭据值。只传递属主专用的文件路径：

```text
GEO_FOUNDRY_PG_USER_FILE=/approved/path/pg-user
GEO_FOUNDRY_PG_PASSWORD_FILE=/approved/path/pg-password
GEO_FOUNDRY_REDIS_PASSWORD_FILE=/approved/path/redis-password
GEO_FOUNDRY_S3_ACCESS_KEY_FILE=/approved/path/s3-access-key
GEO_FOUNDRY_S3_SECRET_KEY_FILE=/approved/path/s3-secret-key
```

安全包装器会校验文件属主与权限后才把值注入子进程。每次运行只能操作自己的命名空间，禁止 `FLUSHDB`、全桶列举和重配共享服务。

详见[运行手册](docs/operations.md)。

## 历史文档

- `.omo/plans/geo-foundry-development-plan.md` 是 2026-08-18 的实施计划，面向旧的产品方向，仅作存档，不再是现行合同。
- `my-deploy/mk-dev.md` 是部署与验证的历史记录，不作为架构依据。
- 上游 PRD 若存在，保存在被 Git 忽略的 `mydocs/`，不要复制或改写其内容。
