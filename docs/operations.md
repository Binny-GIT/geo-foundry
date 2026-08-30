# Geo Foundry 运行手册

- **状态**：现行运维基线
- **日期**：2026-08-27

本文件合并原 `docs/runbooks/` 各篇内容。架构背景见[架构说明](architecture.md)。

## 1. 凭据规则

任何凭据值都不得进入仓库、镜像、日志或文档。只传递属主专用的文件路径，例如：

```text
GEO_FOUNDRY_PG_USER_FILE=/approved/path/pg-user
GEO_FOUNDRY_PG_PASSWORD_FILE=/approved/path/pg-password
GEO_FOUNDRY_S3_ACCESS_KEY_FILE=/approved/path/s3-access-key
```

安全包装器会校验文件属主与权限（不允许 group/other 可读），再把值注入子进程。

mk-dev 的非秘密部署参数保存在 `/opt/geo-foundry/mk-dev.env`（`root:root`，权限 600）。运行时凭据位于 `/opt/geo-foundry/credentials/`：目录必须由容器 uid 1001 所有、权限 0700，单个文件必须为 uid 1001 所有、权限 0600。Compose 仅传递 `*_FILE` 容器路径，并以只读 bind mount 挂载该目录；不得把凭据值写入 `--env-file` 或 Compose 环境。

## 2. 共享服务

PostgreSQL、Redis 与对象存储是宿主机上多个项目共用的服务。本项目**不新增基础设施容器**，只使用自己的数据库、Redis 命名空间和存储前缀。

禁止操作：

- `FLUSHDB` 或清空共享 Redis
- 全桶列举或删除
- 重启、重配共享服务来制造故障
- 触碰不属于本次运行前缀的键或对象

检查与清理只针对本次运行的命名空间：

```sh
pnpm shared:check -- --run-id <lowercase-run-id>
pnpm shared:cleanup -- --run-id <same-run-id>
```

## 3. 部署

镜像在宿主机构建（容器内无法访问 npm registry）：

```sh
make image-build
make container-smoke
make deploy-mk-dev
```

等价的底层命令：

```sh
docker compose --env-file /opt/geo-foundry/mk-dev.env \
  -f deploy/compose.yaml -f deploy/compose.mk-dev.yaml \
  up -d --no-build --force-recreate --wait --wait-timeout 180
```

`secure-run` 只用于宿主机上的迁移、测试和临时开发命令；容器不会执行它。生产 CMS 与 Worker 都在启动时读取 owner-only `*_FILE` 引用。部署后必须先验证本机 `/api/health`，再验证 `/api/readiness` 返回 200；后者同时确认 PostgreSQL 与 RustFS 已就绪。

### 部署注意事项

1. **镜像标签取自 git 提交哈希。** 工作区有未提交改动时标签不变但摘要不同，此时 `up -d --no-build` 不会重建容器，需要加 `--force-recreate`。
2. **部署后必须核对摘要。** 用 `docker inspect` 确认运行中的镜像摘要与本次构建一致，再执行验收。
3. **并行部署前先确认当前 `IMAGE_TAG`。** 曾发生另一轮工作把 `IMAGE_TAG` 覆盖、导致控制台回退的情况。
4. **compose 项目名已固定为 `geo-foundry-${COMPOSE_ENV}`。** 不要移除顶层 `name`，否则会退回以目录名 `deploy` 作为项目名，可能被其他项目的 `docker compose down --remove-orphans` 误删。

### Worker

Worker 与 Web 使用同一镜像，通过启动命令区分角色。CMS 的 Node instrumentation 每秒将 PostgreSQL Outbox 中的 pending 行投递到 Redis；PostgreSQL 仍是事实源，稳定 job ID 保证重复投递安全。mk-dev 覆盖层启用 Worker profile；它必须与 CMS 一同重建，并从同一个只读 owner-only 凭据目录读取 Redis、RustFS 与（若启用）AI Provider key。内部 CMS 调用使用 `content-service-keyring.json`：每个 tenant 对应独立的 `content-service` API key，Worker 按 BullMQ job/ledger 中的 tenant ID 选择 key，绝不将写请求跨 tenant 试探。部署后检查 `geo-foundry-worker-mk-dev` 正常运行，并确认日志中没有 credential、Redis、CMS 或 RustFS 连接失败。`deploy/smoke/smoke.sh` 会进一步执行 `worker-smoke.sh`：从实际 Worker 容器验证 owner-only keyring/Redis 文件可读取、keyring 结构有效、Redis PING 与 CMS health 成功；它不创建 job、不读取或输出凭据值。`make worker-business-smoke` 是单独的 append-only 受保护验证：它只使用明确 marker 的 draft fixture 写入一条 failed assessment，并验证 CMS mutation → transactional Outbox → BullMQ → Worker consumer；assessment/outbox 证据按不可变审计规则保留，因此不应在每次 deploy smoke 自动运行。可运行 `deploy/smoke/runtime-status.sh` 做只读基线检查：它验证 CMS Docker health/restart、CMS/Worker 镜像摘要一致、本机/公网 health、Outbox 与未终结 operation 的年龄、失败发布计划、活跃 RSS connector 轮询时效与备份新鲜度；脚本不读取或输出凭据值。

## 4. 数据库迁移

数据库结构只能通过已提交的迁移演进。不使用 database push，不在 CI 或生产环境生成迁移。

```sh
pnpm --filter @geo/cms db:migrate:status
pnpm --filter @geo/cms db:migrate
```

mk-dev 的迁移在宿主机执行，容器只负责服务。迁移后无需重启容器，连接池会自动感知。

创建迁移只在本地开发环境进行，生成的 TypeScript、snapshot 和索引一并评审提交。

常见错误：

| 错误 | 处理 |
| --- | --- |
| `CMS_CHECKED_IN_MIGRATION_MISSING` | 恢复或提交迁移索引后再执行 |
| `CMS_MIGRATION_GENERATION_FORBIDDEN` | 不要绕过守卫，在本地生成并评审 |
| 凭据文件报错 | 修正 `*_FILE` 的属主与权限，不要把值复制到环境变量或日志 |

破坏性迁移必须等回滚窗口关闭后再执行。

## 5. 发布

### 流程

1. 内容版本通过质量检查并被批准。
2. 提交发布请求，携带稳定的幂等键。
3. 后台任务读取编译快照，编译并校验页面文档与发布清单。
4. 条件创建不可变对象，回读校验字节、内容类型与哈希。
5. 以条件写更新站点当前版本指针。
6. 记录发布回执与任务终态。

**提交成功不等于已发布。** 只有任务进入成功终态并写入回执才算完成。

### 关键约束

- 已发布对象不可覆盖。
- 重放必须复用编译快照中的 `contentModifiedAt` 与内容 `inputHash`，且公开 release 不编码内部 workflow 状态；不能使用会被审计或事件写入刷新的 `updatedAt`、workflow revision 或 workflow status，否则同一版本会产生不同字节而被存储拒绝。
- 指针并发冲突（`ARTIFACT_STORE_POINTER_ETAG_STALE`）是确定性终态，不是需要无限重试的错误。读取最新指针后由业务流程重新决定。

### 验证

通过正式站点访问检查 `X-Geo-Release-Id`、canonical、sitemap 和目标 URL。若返回 `503`，先检查清单、哈希与对象完整性，不要让站点回退到直接读取控制面。

### 禁止操作

覆盖已发布对象、手工编辑当前版本指针、全桶列举、删除其他版本、让站点访问控制面。

## 6. 回滚

回滚只把当前版本指针切换到同一站点、已验证的历史版本。它不重新编译、不修改历史产物、不删除任何版本。

步骤：

1. 确认目标版本属于同一租户与站点，清单与所有产物哈希可验证。
2. 确认当前指针仍满足请求中的预期前置条件。
3. 等待回滚回执与任务成功终态。
4. 通过正式站点验证目标版本号、页面、重定向与 sitemap。
5. 确认其他站点的版本未受影响。

故障处理：

| 情况 | 处理 |
| --- | --- |
| 指针已变化 | 不要重放旧前置条件，重新读取后由授权人员决定 |
| 目标清单或哈希无效 | 停止，绝不能把不完整产物设为当前版本 |
| 目标跨站点 | 停止，这是隔离失败，不是可重试事务 |

**镜像回滚与内容回滚是两件事。** 镜像回滚步骤：

1. 编辑 `/opt/geo-foundry/mk-dev.env`，把 `IMAGE_TAG` 改回上一个可用标签。
2. 执行 `make rollback-mk-dev`。
3. 确认监控目标恢复健康。

## 7. 任务恢复

数据库中的任务记录是事实源，Redis 与 BullMQ 不是。

Worker 启动时立即读取未终结任务，并每五分钟执行一次低频兜底恢复；到期发布计划仍每秒轮询。恢复按稳定任务 ID 重新入队，相同任务 ID 会被去重，因此重复恢复不会产生重复副作用；已终结任务不会重新入队。

处理步骤：

1. 确认 Worker 使用批准的凭据文件引用启动。
2. 查看未终结任务列表及各自的尝试次数、当前阶段和错误。
3. 恢复 Redis 连通性后让 Worker 自行恢复，不要手工写入队列键。
4. 长时间不收敛的任务，保留任务 ID、错误代码和不含凭据的日志，再按业务状态处理。
5. `content-intake` 的永久失败会写入 IntakeItem 的 `failureCode` 与 `failureReason`；修复来源后从稿源箱执行 retry，而不是手工写入 Redis。

禁止：重启共享 Redis、使用 `FLUSHDB`、扫描或删除非本次运行前缀的键、把已终结任务强行改回排队状态。

## 8. 事故处理

**第一原则**：先保全证据和当前版本指针，再执行恢复。不要为了尽快恢复服务而修改共享服务配置、删除存储内容、重建共享数据库或输出凭据。

### 站点返回 503

1. 记录 host、路径、版本号和不含凭据的错误代码。
2. 校验站点指针、路由清单、发布清单以及对象的字节、内容类型与哈希。
3. 若是本次操作导致的产物损坏或缺失，恢复精确的原始字节，不要用其他站点或版本的对象替换。
4. 确认恢复预期状态码后再清理本次运行前缀。

### 发布或回滚指针冲突

保留失败任务的终态记录。读取当前指针后重新评估，不要无限重试，也不要手工覆盖指针。

### 稿源抓取失败

- `INTAKE_URL_PRIVATE_*`、`INTAKE_URL_PORT_FORBIDDEN`、`INTAKE_REDIRECT_*`：来源触发 SSRF 防护，不重试，改用公开可访问的 URL。
- `INTAKE_RESPONSE_TOO_LARGE`、`INTAKE_CONTENT_TYPE_UNSUPPORTED`、`INTAKE_EXTRACTION_EMPTY`：缩小来源或选择可解析的公开内容后重新提交。
- `INTAKE_FETCH_TIMEOUT`、`INTAKE_DNS_FAILED`、`INTAKE_HTTP_429`、`INTAKE_HTTP_5xx`：Worker 会按队列策略重试；最终失败后在稿源箱显示 retry。
- 原始响应和提取正文快照均为不可覆盖对象；不要手工删除或替换对象来修复稿源。

### 权限异常

保留越权访问记录、响应形态、请求 ID 和不含凭据的日志。不要用超级管理员身份或绕过访问控制的方式去"验证"生产数据，先确认服务层的租户守卫与会话声明。

## 9. AI Provider

Worker 默认使用 `AI_PROVIDER=fake`，用于测试和未配置外部模型的环境。只有明确设置 `AI_PROVIDER=openai-compatible` 时，Worker 才会读取以下配置：

```text
AI_BASE_URL=https://provider.example/v1
AI_CHAT_MODEL=<chat-model>
AI_EMBEDDING_MODEL=<embedding-model>
AI_API_KEY_FILE=/approved/path/ai-api-key
```

`AI_API_KEY_FILE` 必须为当前 Worker 用户拥有且权限为 0600 的文件。配置不完整会在 Worker 启动时 fail closed；不要用空 key 回退到 Fake Provider，也不要把 key 写入 Compose、日志、仓库或测试报告。

## 10. 备份

- **PostgreSQL**：定期备份并验证可恢复，这是唯一事实源。
- **对象存储**：发布产物和稿源快照不可覆盖，删除策略必须保守。
- **凭据文件**：单独离线保管，不随仓库或镜像分发。

恢复演练至少覆盖：数据库恢复后控制台可登录、已发布站点仍可访问、未终结任务可恢复。mk-dev 上执行 `make verify-backup-restore` 会恢复最新 owner-only dump 到一次性验证数据库、检查表和 migration 记录后自动删除验证库；`make runtime-status` 则执行不含写操作的运行基线检查。

## 11. 已知问题

- 共享隧道单请求延迟 1–3 秒是宿主机链路特征，与本项目无关。

## 相关文档

- [产品说明](product.md)
- [架构说明](architecture.md)
- [开发计划](development-plan.md)
- [部署历史记录](../my-deploy/mk-dev.md)
