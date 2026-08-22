# ADR 002：PageDocument 显式版本化

- **状态**：已采纳
- **日期**：2026-08-22

## 决策

所有渲染输入使用严格的 PageDocument v1 schema。编译器负责将编辑数据归一化成 PageDocument，Renderer 仅消费该文档；schema、release manifest、routing manifest 都有显式版本和公开 export。

不支持的 schema version、未知 block、未归一化的 Payload storage-only 字段或不满足发布 manifest 的对象都必须在编译或 Runtime 验证阶段失败，不做隐式兼容猜测。

## 后果

- 新字段或语义变化需要新增版本或受控 migration，不能修改旧文档含义。
- 包消费者从 `@geo/schema`、`@geo/schema/release/v1` 或 `@geo/schema/page-document.schema.json` 使用公开 contract。
- SSR host 不拥有独立页面模型，因此 Site A 与 Site B 的 SEO、JSON-LD、canonical 和 redirect 语义一致。

## 实现依据

- `packages/schema/src/`
- `packages/compiler/src/`
- `packages/render-core/`
- `packages/render-react/`
