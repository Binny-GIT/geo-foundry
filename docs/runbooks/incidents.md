# Runbook：事故分流

## 第一原则

先保全证据和当前 pointer，再执行任何恢复操作。不要为了“恢复服务”而修改共享 Redis 配置、删除 bucket 内容、重建共享 PostgreSQL、输出凭据或杀死非本 run 创建的进程。

## 服务面 `503`

1. 记录 host/path、`X-Geo-Release-Id`（若存在）和 Runtime 无密钥错误代码。
2. 验证 site pointer、routing manifest、release manifest、对象 bytes/content type/SHA-256。
3. 若是本次 attempt-owned artifact tamper/missing fault，恢复精确原 bytes；不要用其他 site/release 对象替换。
4. 确认恢复 `200/301/404/410` 的预期 status，再清理本 run prefix。

## 发布或回滚 CAS 冲突

保留 loser operation 的 `ARTIFACT_STORE_POINTER_ETAG_STALE` 终态。读取当前 pointer 后由授权主体重新评估；不要把 stale operation 无限重试，也不要手工覆盖 pointer。

## Worker 不收敛

收集 operation ID、stage、attempt、stable job ID、错误代码和 Redis prefix。恢复连接后让 reconciliation 运行。若必须实验，使用新的 run-owned prefix 和测试 worker；不得停止共享 Redis。

## 租户/授权异常

把 foreign access、403 响应形状、请求 ID 与无密钥日志保留为 evidence。不要用 super-admin 或 `overrideAccess` 绕过来“验证”生产数据；先确认服务层 tenant guard 与 session claim。

## 测试报告或 CI 失败

保留失败运行的原生 JUnit、JSON、HTML、Playwright trace 与 fault matrix 报告。公共 CI 只依赖命令退出状态；受保护报告保留在 runner 临时目录并以最小权限上传。修复根因后使用新的临时报告目录重跑，绝不把凭据、`.env`、本地 volume 或运行时机密写入报告。
