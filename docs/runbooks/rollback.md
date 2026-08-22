# Runbook：回滚已验证 release

## 原则

回滚不重新编译、不变更历史 artifact，也不删除 release。它只通过 CAS 将 site current pointer 移到一个已验证、同站点的历史 release。

## 提交与轮询

向 Content Service 提交 `POST /v1/rollback`，请求必须带稳定 `Idempotency-Key` 和对 current/target release 的预期标识。轮询：

```text
GET /v1/operations/<operation-id>
```

同一 key/同一 payload replay 原 operation；同 key/不同 payload 返回冲突。不要通过新建 release 来模拟 rollback。

## 验证步骤

1. 确认 target release 属于同一 tenant/site，manifest 与所有 artifact hash 可验证。
2. 确认 current pointer 仍符合请求的 expected ETag/release/manifest 前置条件。
3. 等待 rollback receipt 与 operation terminal succeeded。
4. 用正式服务 host 验证目标 `X-Geo-Release-Id`、页面/redirect/sitemap。
5. 验证其它 site 的 release header 未变化。

## 故障处理

- stale pointer：当前版本已改变。不要重放旧前置条件；重新读取 pointer 后由授权主体决定。
- target manifest/hash 无效：停止；不可把不完整对象设为 current。
- cross-site target：停止；这是 tenant/site 隔离失败，不是可重试事务。

镜像或应用部署回滚与内容 release rollback 不同；部署流程见受控部署文档，不能替代本 runbook。
