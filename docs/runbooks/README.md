# Geo Foundry 运行手册

| 场景 | Runbook |
| --- | --- |
| 已有 PostgreSQL/Redis/RustFS 的 namespace 检查和 cleanup | [共享服务](shared-services.md) |
| 已提交 CMS schema migration 的状态和应用 | [Migration](migrations.md) |
| 发布 immutable release | [Publish](publish.md) |
| 通过 pointer CAS 回滚 | [Rollback](rollback.md) |
| Redis/BullMQ 丢失后的 ledger reconciliation | [Reconciliation](reconciliation.md) |
| evidence manifest/receipt 收集与验证 | [Evidence](evidence.md) |
| 服务面、CAS、Worker、租户或 CI 故障分流 | [Incidents](incidents.md) |

所有命令都假设使用批准的 secure runner 和 owner-only `*_FILE` 凭据引用。不要将任何凭据值、临时 env、evidence 或 `.zcode` 状态加入 Git。
