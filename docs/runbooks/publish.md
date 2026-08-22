# Runbook：发布不可变 release

## 前置条件

- Edition 已通过质量 gate，并由 reviewer/publisher 按状态机推进。
- 调用方拥有 tenant 范围内的操作权限。
- 请求具有稳定、唯一的 `Idempotency-Key`；重试同一请求必须复用该 key。
- Worker、控制面与共享对象存储在批准环境中可用。

## 提交与轮询

向 Content Service 提交 `POST /v1/publish`。成功创建返回 `202` 和 operation 的 `Location`；相同 idempotency key 且相同 body 返回原操作的 `200` replay。轮询：

```text
GET /v1/operations/<operation-id>
```

不要把 `202` 当作已发布。只有 terminal succeeded operation 与 publish receipt 才表示完成。

## Worker 行为

publish worker：

1. 读取 approved edition 的 compile snapshot；
2. 编译并验证 PageDocument/release manifest；
3. 条件创建 immutable objects；
4. 远端读取/校验对象；
5. 以 ETag CAS 更新 site current pointer；
6. 记录 release receipt 与 terminal operation result。

CAS stale error 是可审计并发终态。不要重复提交不同 release 以“覆盖”当前 pointer；读取最新 pointer 后由业务流程重新决定。

## 验证

使用服务面 host 检查 `X-Geo-Release-Id`、canonical、sitemap 和目标 URL。Runtime 若报告 `503`，先检查 manifest/hash/object 完整性，而不是回退到 CMS 直读。

## 禁止操作

不要覆盖已发布对象、手工编辑 current pointer、全桶列举、删除其它 release 或让服务 host 访问控制面。
