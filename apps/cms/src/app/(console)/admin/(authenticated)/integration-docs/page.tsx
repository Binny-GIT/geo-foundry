import Link from "next/link"

import { LinkIcon } from "@/components/icons"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsoleSession } from "@/console/lib/session.server"

export const metadata = { title: "接入文档 | Geo Foundry" }

const CodeBlock = ({ children }: { readonly children: string }) => (
  <pre className="m-0 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs leading-6 text-slate-100">
    <code>{children}</code>
  </pre>
)

const FieldTable = ({
  rows,
}: {
  readonly rows: readonly (readonly [string, string, string, string])[]
}) => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse text-left text-xs leading-6">
      <thead>
        <tr className="text-[var(--console-ink-muted)]">
          <th className="border-b border-[var(--console-border)] px-3 py-2 font-semibold">字段</th>
          <th className="border-b border-[var(--console-border)] px-3 py-2 font-semibold">类型</th>
          <th className="border-b border-[var(--console-border)] px-3 py-2 font-semibold">必填</th>
          <th className="border-b border-[var(--console-border)] px-3 py-2 font-semibold">说明</th>
        </tr>
      </thead>
      <tbody className="text-[var(--console-ink)]">
        {rows.map(([field, type, required, note]) => (
          <tr key={field} className="align-top">
            <td className="border-b border-[var(--console-border)] px-3 py-2 font-mono whitespace-nowrap">
              {field}
            </td>
            <td className="border-b border-[var(--console-border)] px-3 py-2 whitespace-nowrap text-[var(--console-ink-muted)]">
              {type}
            </td>
            <td className="border-b border-[var(--console-border)] px-3 py-2 whitespace-nowrap text-[var(--console-ink-muted)]">
              {required}
            </td>
            <td className="border-b border-[var(--console-border)] px-3 py-2 text-[var(--console-ink-muted)]">
              {note}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const SectionTitle = ({ children }: { readonly children: string }) => (
  <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
    {children}
  </h2>
)

const Muted = ({ children }: { readonly children: React.ReactNode }) => (
  <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">{children}</p>
)

const IntegrationDocsPage = async () => {
  await requireConsoleSession("/admin/integration-docs")

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        icon={LinkIcon}
        meta={
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            自动化投稿 · 只进收件箱 · 无发布权限
          </span>
        }
        title="接入文档"
      />

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <SectionTitle>接入模型：外部工具只投稿，发布始终是人</SectionTitle>
        <Muted>
          自动化工具（n8n / Dify / 脚本 / AI agent）用你个人的 API-Key
          把内容投进「收件箱」，投稿记在你的名下；采纳成草稿后文章
          <strong className="text-[var(--console-ink)]">作者归属是你</strong>
          ，并标注「AI 生成」来源。采纳、编辑、流转、发布全部由人在 Console
          完成。密钥的权限面与你的账号角色无关——
          只有投稿：即使密钥泄露，影响面也只是「向收件箱投稿」。
        </Muted>
        <Muted>
          投稿三条通道：<strong className="text-[var(--console-ink)]">webhook</strong>
          （推荐自动化工具：直接投 Markdown 正文，入箱即「内容就绪」）、
          <strong className="text-[var(--console-ink)]">url</strong>（只投链接，平台抓取全文）、
          <strong className="text-[var(--console-ink)]">rss</strong>
          （平台按采集源定时轮询，无需外部工具触发）。 采集源（RSS 地址、轮询间隔）在「
          <Link className="underline" href="/admin/connectors">
            采集源
          </Link>
          」页管理。
        </Muted>
        <Muted>
          机器可读契约（OpenAPI 3.1，含全部字段、响应与错误码，可直接喂给 AI agent 生成调用）：
          <code className="rounded bg-[var(--console-surface)] px-1.5 py-0.5 font-mono text-xs">
            GET /api/integration/openapi.json
          </code>
          （公开只读，无需认证）。
        </Muted>
      </section>

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <SectionTitle>第一步：创建 API-Key</SectionTitle>
        <Muted>
          在「
          <Link className="underline" href="/admin/integrations">
            集成密钥
          </Link>
          」页<strong className="text-[var(--console-ink)]">为自己创建</strong>一把密钥（明文以{" "}
          <code className="font-mono">gfa_</code>{" "}
          开头，只在创建时展示一次，请立即复制到你的工具）。可设有效期，随时吊销。
          密钥跟创建者走：用它投稿的条目记在你名下，采纳成文章后
          <strong className="text-[var(--console-ink)]">作者归属是你</strong>
          ，并标注「AI 生成」来源。
        </Muted>
        <CodeBlock>{`# 所有请求带同一个认证头（注意 users 和 API-Key 之间的空格）：
Authorization: users API-Key gfa_xxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
      </section>

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <SectionTitle>投稿接口：POST /api/intake-operations</SectionTitle>
        <FieldTable
          rows={[
            ["title", "string ≤1000", "全部通道", "标题，去重判定键之一。"],
            [
              "channel",
              "manual|url|webhook|rss",
              "必填",
              "外部工具用 webhook（直投正文）或 url（投链接）。",
            ],
            [
              "bodyMarkdown",
              "string ≤200000",
              "webhook 推荐",
              "Markdown 正文，仅 webhook 通道允许；块结构校验失败返回 400。带上它条目直接「内容就绪」，无需抓取。",
            ],
            [
              "suggestedSiteId",
              "integer",
              "webhook 必填",
              "建议采纳站点 id，先查 GET /api/sites 取本租户站点（status=active）。",
            ],
            [
              "sourceUrl",
              "string ≤4000",
              "url 必填",
              "来源链接；utm/fbclid 等追踪参数会被自动去掉再查重。",
            ],
            [
              "connectorId",
              "integer",
              "rss 必填",
              "关联采集源 id，一般由平台轮询使用，外部工具通常不填。",
            ],
            [
              "contentHash",
              "string ≤512",
              "可选",
              "内容寻址哈希；提供后同哈希重投直接命中幂等，不新增稿源。",
            ],
            ["summary", "string ≤20000", "可选", "摘要。"],
          ]}
        />
        <CodeBlock>{`# webhook 直投（推荐）：内容已在手，入箱即「内容就绪」
curl -X POST https://<本站域名>/api/intake-operations \\
  -H "Authorization: users API-Key gfa_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: n8n-flow-17-item-3" \\
  -d '{
    "channel": "webhook",
    "title": "自动驾驶保险的三个新问题",
    "summary": "简短摘要",
    "bodyMarkdown": "# 标题\\n\\n正文 markdown…",
    "suggestedSiteId": 374
  }'

# url 投稿：只给链接，平台排队抓取全文
curl -X POST https://<本站域名>/api/intake-operations \\
  -H "Authorization: users API-Key gfa_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"url","title":"标题","sourceUrl":"https://example.com/post"}'`}</CodeBlock>
        <Muted>
          <strong className="text-[var(--console-ink)]">幂等：</strong>
          优先 contentHash，其次 webhook 正文哈希，再次 Idempotency-Key；重试返回首次结果（
          <code className="font-mono">idempotentReplay=true</code> 或 duplicateIds
          指向既有条目），不会塞满收件箱，网络超时重试是安全的。
          <strong className="text-[var(--console-ink)]">守卫：</strong>
          每身份 120 次/分钟、请求体上限 1MiB，超限返回 429/413。
        </Muted>
        <Muted>
          响应：<code className="font-mono">201</code> 新建（webhook 条目 status=
          <code className="font-mono">ready</code>，url 已入抓取队列）、
          <code className="font-mono">200</code> 重复/幂等重放、
          <code className="font-mono">202</code> 已建档但抓取队列暂不可用。常见错误码：
          <code className="font-mono">INTAKE_SUGGESTED_SITE_REQUIRED</code>（webhook 缺站点）、
          <code className="font-mono">INTAKE_BODY_MARKDOWN_EMPTY</code>（正文空白）、
          <code className="font-mono">INTAKE_URL_INVALID</code>（链接非 http/https）。
        </Muted>
      </section>

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <SectionTitle>引用数据：站点与采集源（只读）</SectionTitle>
        <CodeBlock>{`GET /api/sites?limit=100          # 本租户站点：docs[].id 即 suggestedSiteId 可选值
GET /api/connectors?limit=100     # 本租户采集源：docs[].id/name/type/status`}</CodeBlock>
        <Muted>
          两个列表用同一个 API-Key，分页参数 <code className="font-mono">page/limit/sort</code>
          ，limit 上限 100。automation 身份对二者只读——采集源的增删改在 Console 人工操作。
        </Muted>
      </section>

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <SectionTitle>n8n / Dify 接法</SectionTitle>
        <Muted>
          <strong className="text-[var(--console-ink)]">n8n：</strong>加一个 HTTP Request 节点 ——
          Method 选 POST，URL 填{" "}
          <code className="font-mono">https://&lt;本站域名&gt;/api/intake-operations</code>；
          Authentication 选 Generic Credential Type → http Header Auth（Name 填
          <code className="font-mono">Authorization</code>，Value 填
          <code className="font-mono">users API-Key gfa_…</code>）；Body Content Type 选 JSON
          并映射上游字段。建议在 Headers 里带 <code className="font-mono">Idempotency-Key</code>
          （用表达式拼接流程 id + 条目 id）。
        </Muted>
        <Muted>
          <strong className="text-[var(--console-ink)]">Dify：</strong>工作流加 HTTP 节点，Method
          POST、同一 URL，API-Key 自定义认证头（同上格式），Body 用 JSON 模式粘贴请求体，把{" "}
          <code className="font-mono">title/bodyMarkdown/suggestedSiteId</code> 绑定到上游变量。
        </Muted>
        <Muted>
          <strong className="text-[var(--console-ink)]">AI agent：</strong>把{" "}
          <code className="font-mono">/api/integration/openapi.json</code> 的内容作为工具描述喂给
          agent，即可自动生成可运行的投稿调用。
        </Muted>
      </section>

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <SectionTitle>公开只读：站点侧拉取已发布内容（无需认证）</SectionTitle>
        <CodeBlock>{`GET /api/delivery/sites/{canonical-domain}/articles?page=1&limit=20&q=关键词
GET /api/delivery/articles/{editionId}`}</CodeBlock>
        <ul className="m-0 list-disc pl-6 text-sm leading-6 text-[var(--console-ink-muted)] [&>li]:mb-1.5 [&>li]:last:mb-0">
          <li>
            列表返回 <code>docs[].id/title/summary/pathname/publishedAt</code>；limit 上限 50，默认
            20； 详情返回完整正文块（body）与 locale。
          </li>
          <li>域名必须是该站点「启用状态的规范域名」；未发布或站点未启用一律 404。</li>
          <li>
            每 IP 每分钟 60 次，超限 429；接口自带 60 秒 HTTP 缓存头，建议客户端再缓存 5–15 分钟。
          </li>
        </ul>
        <CodeBlock>{`const res = await fetch(
  "https://<本站域名>/api/delivery/sites/<你的规范域名>/articles?limit=20",
  { next: { revalidate: 300 } },
)
const { docs } = await res.json()`}</CodeBlock>
      </section>
    </div>
  )
}

export default IntegrationDocsPage
