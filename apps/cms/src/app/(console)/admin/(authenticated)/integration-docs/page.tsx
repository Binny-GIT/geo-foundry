import { requireConsoleSession } from "@/console/lib/session.server"

export const metadata = { title: "接入文档 | Geo Foundry" }

const CodeBlock = ({ children }: { readonly children: string }) => (
  <pre className="m-0 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs leading-6 text-slate-100">
    <code>{children}</code>
  </pre>
)

const IntegrationDocsPage = async () => {
  await requireConsoleSession("/admin/integration-docs")

  return (
    <div className="grid gap-6">
      <header>
        <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">系统</p>
        <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
          接入文档
        </h1>
        <p className="m-0 max-w-2xl pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
          品牌网站从本系统拉取文章的公开只读接口。只暴露「已发布 + 启用站点」的内容，无需登录，带每 IP 限流；所有调用计入接口统计。
        </p>
      </header>

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
          文章列表
        </h2>
        <CodeBlock>{`GET /api/delivery/sites/{canonical-domain}/articles?page=1&limit=20&q=关键词`}</CodeBlock>
        <ul className="m-0 grid list-disc gap-1.5 pl-6 text-sm leading-6 text-[var(--console-ink-muted)]">
          <li><code>page</code> / <code>limit</code>：分页，limit 上限 50，默认 20。</li>
          <li><code>q</code>：标题关键词（可选）。</li>
          <li>域名必须是该站点「启用状态的规范域名」。</li>
        </ul>
        <CodeBlock>{`{
  "docs": [
    {
      "id": 565,
      "title": "文章标题",
      "summary": "摘要",
      "pathname": "/articles/example",
      "url": "/articles/example",
      "publishedAt": "2026-08-30T12:00:00.000Z",
      "updatedAt": "2026-08-30T12:00:00.000Z"
    }
  ],
  "page": 1,
  "totalDocs": 1,
  "totalPages": 1
}`}</CodeBlock>
      </section>

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
          文章详情
        </h2>
        <CodeBlock>{`GET /api/delivery/articles/{editionId}`}</CodeBlock>
        <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
          返回单篇已发布文章的完整正文块（body）与 URL；未发布或站点未启用一律 404。
        </p>
      </section>

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
          站点侧拉取示例（Next.js / fetch）
        </h2>
        <CodeBlock>{`const res = await fetch(
  "https://<本站域名>/api/delivery/sites/<你的规范域名>/articles?limit=20",
  { next: { revalidate: 300 } }, // 建议缓存 5 分钟；接口自带 60s HTTP 缓存头
)
const { docs } = await res.json()
// docs[i].title / summary / pathname(用于拼站点内链接) / publishedAt`}</CodeBlock>
        <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
          建议站点按 5–15 分钟增量拉取列表、按需拉取详情；错误码：404 站点/文章不存在，429 触发限流（每 IP 每分钟 60 次）。
        </p>
      </section>
    </div>
  )
}

export default IntegrationDocsPage
