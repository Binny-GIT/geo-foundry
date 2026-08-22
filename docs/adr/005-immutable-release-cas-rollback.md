# ADR 005：不可变发布、pointer CAS 与回滚

- **状态**：已采纳
- **日期**：2026-08-22

## 决策

每个 release 都是一组不可变对象：页面、sitemap、release manifest 与 routing 信息先被上传和验证，current pointer 最后以 ETag compare-and-swap 更新。对象 key、bytes、content type 和 SHA-256 必须与 manifest 一致。

并发 publish/rollback 对同一 site pointer 只有一个 CAS winner。`ARTIFACT_STORE_POINTER_ETAG_STALE` 是确定性的并发终态，而非无限重试。回滚仅把 pointer 指向已验证的旧 release；它不重新编译、不删除 artifact、不重写 release 内容。

## 后果

- 服务面只会看到完整、hash-verified release 或 `503`，不会看到 mixed release。
- CAS 成功但控制面 receipt 写入失败时，恢复流程必须 exact replay，不能 churn pointer ETag。
- S3 cleanup 只能针对本次 attempt-owned prefix；不能全桶列举或删除。

## 实现依据

- `packages/publisher/src/publish.ts`
- `packages/publisher/src/rollback.ts`
- `packages/publisher/src/artifact-store.ts`
- `apps/worker/test/unit/release-pipeline.test.ts`
- `tests/faults/run.mjs`
