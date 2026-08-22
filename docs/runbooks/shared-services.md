# Runbook：共享服务环境与有界清理

## 适用范围

本 runbook 只用于批准的本机或 protected runner 已有 PostgreSQL、Redis 与 RustFS 服务。不要创建、停止、重启或重配这些共享服务。

## 前置条件

准备当前用户拥有且无 group/other 权限的文件引用：

```text
GEO_FOUNDRY_PG_USER_FILE=/approved/path/pg-user
GEO_FOUNDRY_PG_PASSWORD_FILE=/approved/path/pg-password
GEO_FOUNDRY_REDIS_PASSWORD_FILE=/approved/path/redis-password
GEO_FOUNDRY_S3_ACCESS_KEY_FILE=/approved/path/s3-access-key
GEO_FOUNDRY_S3_SECRET_KEY_FILE=/approved/path/s3-secret-key
```

另提供非秘密连接配置（host、port、database、schema、TLS/path-style 开关）。不要将值写入 `.env`、shell history、仓库或 evidence。

## 检查与清理

选择一个小写连字符 run ID，长度 3–48，例如 `<run-id>`：

```sh
pnpm shared:check -- --run-id <run-id>
pnpm shared:cleanup -- --run-id <run-id>
```

`shared:check` 写入该 run 的 manifest，并仅创建/验证：

- 一个 `geo_foundry` schema 下的 probe table；
- 一个 `geo-foundry:<run-id>:connectivity` Redis key；
- `objects/<run-id>/` 下两个 S3 probe 对象。

`shared:cleanup` 读取同一 manifest，验证它与 run ID 精确匹配，再删除列出的资源。它不使用 `FLUSHDB`、不全桶列举、不会删除其它 run 的 key/object/table。

## 故障处理

- `SHARED_SERVICE_ENV_MISSING`：补齐变量的**文件路径**，不要传递明文凭据。
- `SHARED_SERVICE_CREDENTIAL_FILE_INSECURE`：修正文件 owner 和权限；不要通过放宽 secure runner 绕过检查。
- `SHARED_SERVICE_LOCK_COLLISION`：等待当前 Geo Foundry run 完成或选择新的 run ID；不要 kill 共享服务。
- `SHARED_SERVICE_MANIFEST_MISMATCH` / `SHARED_SERVICE_FOREIGN_PREFIX`：停止清理，使用最初的 run ID 和未修改 manifest；不要手动扩大删除范围。
