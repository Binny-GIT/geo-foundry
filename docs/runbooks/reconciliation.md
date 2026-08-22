# Runbook：Worker reconciliation

## 行为

CMS operation ledger 是事实来源，Redis/BullMQ 不是。Worker 启动时及运行期间会读取 non-terminal operations，并按稳定 job ID 重新入队。BullMQ 对相同 job ID 去重，因此重复 reconciliation 不产生重复业务副作用；已终态的 succeeded、failed、cancelled operation 不重入队。

## 操作

1. 确认 Worker 使用批准的 `*_FILE` Redis/S3/CMS 凭据引用启动。
2. 检查控制面的 non-terminal operation 列表与每个 operation 的 attempt/current stage/error。
3. 恢复 Redis 连通性后让 Worker 自行 reconciliation；不要手工写入 BullMQ key。
4. 对一段时间仍无法收敛的 operation，保留 operation ID、稳定 job ID、错误代码与无密钥日志作为 evidence，再按业务状态机处理。

## 验证

在批准环境中运行拥有独立 Redis prefix 的 Worker integration/fault case。它必须证明：

- enqueue `ECONNREFUSED` 后 operation 可恢复；
- 两个 reconciler 只产生一次副作用；
- force-close 的测试 worker 锁释放后由一个 recovery worker 接管；
- teardown 后 owned Redis prefix 为空。

## 禁止操作

不要重启共享 Redis 来制造故障，不要使用 `FLUSHDB`，不要扫描/删除不是当前 run prefix 的 key，也不要将 terminal operation 强行恢复为 queued。
