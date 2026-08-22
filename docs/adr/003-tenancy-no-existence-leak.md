# ADR 003：租户范围与不存在性泄露防护

- **状态**：已采纳
- **日期**：2026-08-22

## 决策

PostgreSQL/Payload 是 tenant、site、content、edition、operation、release 和审计记录的权威来源。会话 claim 默认拒绝；除 super-admin 外的主体必须 tenant-bound。内部服务 endpoint 仅接受 tenant-bound content-service 身份。

所有跨租户读取、更新、operation stage、release、embedding 和 URL 操作都在访问层与服务层重复校验。对外响应使用稳定的 `403` 和代码，不返回 foreign resource 的标题、ID、版本、manifest 或其它存在性线索。

## 后果

- `overrideAccess: true` 只能在服务层显式 tenant guard 之后使用。
- idempotency unique key 包含 tenant、endpoint 与 caller key；同一 key 在不同 tenant 中彼此独立。
- RustFS/Redis 清理由 run ID/prefix 限定，不能用控制面记录去扩大删除范围。

## 实现依据

- `apps/cms/src/access/`
- `apps/cms/src/services/operations-ledger.ts`
- `apps/cms/src/endpoints/internal/guards.ts`
- `apps/cms/test/integration/tenant-access.test.ts`
