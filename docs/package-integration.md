# Geo Foundry 包集成指南

## 公开消费 contract

所有公开包均为 ESM-only，并且只发布 `dist/` 和 `package.json`。消费者必须通过 package export map 导入，不能依赖仓库路径、`src/`、`dist/` 深层路径或未声明子路径。

在发布或接入变更前执行：

```sh
pnpm packages:validate
pnpm packages:pack-smoke
pnpm packages:pack-smoke:task6:pnpm
pnpm packages:pack-smoke:task6:npm
```

这些命令分别检查 package manifest/export 边界、所有 tarball 的真实消费者安装，以及 Schema/Publisher 的公开 API 消费。

## 包矩阵

| 包 | 责任 | 公开入口 |
| --- | --- | --- |
| `@geo/schema` | PageDocument、release schema、JSON schema | `@geo/schema`、`@geo/schema/release/v1`、`@geo/schema/page-document.schema.json` |
| `@geo/domain` | 状态机、ID、URL 和领域错误 | `@geo/domain` |
| `@geo/content-client` | 控制面 HTTP contract/client | `@geo/content-client` |
| `@geo/content-pipeline` | generate/evaluate/provider abstraction | `@geo/content-pipeline` |
| `@geo/quality-rules` | 确定性与语义质量 gate | `@geo/quality-rules` |
| `@geo/compiler` | Edition 到 PageDocument/release 输入编译 | `@geo/compiler` |
| `@geo/publisher` | 不可变对象发布、pointer CAS、rollback | `@geo/publisher`、`@geo/publisher/artifact-store` |
| `@geo/runtime` | 服务面 release resolver | `@geo/runtime` |
| `@geo/render-core` | PageDocument render primitives | `@geo/render-core` |
| `@geo/render-react` | React SSR renderer | `@geo/render-react` |
| `@geo/testing` | evidence 与 package architecture 验证 | `@geo/testing` |

## Host 集成

服务 host 应按以下顺序工作：

1. 使用 `@geo/runtime` 根据 host/path 解析已发布 release。
2. 对 `page` 结果使用 `@geo/render-react` 渲染 PageDocument。
3. 对 `redirect`、`not-found`、`gone` 和 `unavailable` 使用 Runtime 给出的 status/headers。
4. 不在 host 中查询 CMS、重新编译页面、重算 canonical/SEO 或绕过 manifest/hash 校验。

Site A Next 与 Site B Express 是完整范例，分别位于 `examples/site-a-next/` 和 `examples/site-b-express/`。

`@geo/render-react` 的 React/ReactDOM 是 consumer peer dependency。`@geo/runtime` 的生产依赖面只包含 `@geo/schema`，用于保持服务面与控制面分离。

## 兼容性

- PageDocument/release schema 通过显式版本演进；未支持版本 fail closed。
- 新公共 API 必须更新 export map、类型、API extractor report 和 packed consumer smoke。
- 不允许以 `file:`、`link:` 或未发布的 `workspace:` 依赖范围出现在最终 tarball 中。
