# ADR 001：控制面与服务面分离

- **状态**：已采纳
- **日期**：2026-08-22

## 决策

CMS、Content Service 和 Worker 构成控制面：它们负责租户、身份、编辑状态、operation ledger、质量、编译、发布和回滚。Runtime 与各 SSR host 构成服务面：请求处理只读取 routing manifest、site pointer、release manifest、页面对象和 sitemap。

服务面不得依赖 CMS、PostgreSQL、Redis、BullMQ、编译器、质量规则或 LLM provider。对象不可用、manifest 不一致或 hash 不匹配时，Runtime fail closed 为 `503`；未知 host 仍为 `404`。

## 后果

- 已发布内容在控制面停止后仍可被冷启动 Runtime 提供。
- 发布必须完整写入不可变对象并 CAS 更新 pointer，不能让服务面回退到控制面查询。
- 需要控制面状态的 E2E、fault 和 migration 只能在受保护共享服务 runner 执行。

## 实现依据

- `packages/runtime/`
- `examples/site-a-next/server/server.mjs`
- `examples/site-b-express/server/app.mjs`
- `packages/runtime/scripts/serving-isolation.mjs`
