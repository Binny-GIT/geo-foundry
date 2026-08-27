# 工作区包说明

`packages/` 下的包都是**内部包**，只在本仓库内使用，不对外发布。

早期版本按对外发布的公共包来维护它们（导出契约、API 报告、tarball 消费者验证）。这些包没有外部使用者，相关机制按[架构说明](architecture.md)的结论移除。

## 包矩阵

| 包 | 职责 |
| --- | --- |
| `@geo/schema` | 页面文档与发布清单结构 |
| `@geo/domain` | 状态机、标识、URL 与领域错误 |
| `@geo/compiler` | 内容版本编译为页面文档与发布输入 |
| `@geo/publisher` | 不可变发布、指针切换、回滚 |
| `@geo/runtime` | 服务面解析已发布产物 |
| `@geo/render-core` | 页面渲染原语 |
| `@geo/render-react` | React 服务端渲染 |
| `@geo/quality-rules` | 确定性与语义质量检查 |
| `@geo/content-pipeline` | 生成与评估流程 |
| `@geo/content-client` | 控制面内部接口客户端 |
| `@geo/testing` | 测试辅助 |

## 使用约定

- 包之间通过声明的入口互相引用，不做深层源码路径导入。
- `@geo/runtime` 的生产依赖只包含 `@geo/schema`，用于保持服务面与控制面分离。
- `@geo/render-react` 把 React 与 ReactDOM 作为 peer dependency。
- 页面文档与发布清单通过显式版本演进，未支持的版本直接失败而不是猜测。

## 站点接入

站点按以下顺序工作：

1. 用 `@geo/runtime` 根据域名与路径解析已发布版本。
2. 用 `@geo/render-react` 渲染页面文档。
3. 对重定向、未找到、已删除和不可用状态，使用 Runtime 返回的状态码与响应头。
4. 不在站点中查询控制面、重新编译页面、重算 SEO 或跳过清单与哈希校验。

`examples/site-a-next` 与 `examples/site-b-express` 是多站点隔离测试的 Fixture，不是产品的一部分。

## 相关文档

- [架构说明](architecture.md)
- [运行手册](operations.md)
