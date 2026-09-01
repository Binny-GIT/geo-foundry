import { previewBlockOf } from "@/components/content-edition/page-document-preview-adapter"

/**
 * Read-only server rendering of stored edition blocks for the article detail
 * page. Editing stays in the dedicated three-pane workspace; this view never
 * writes anything.
 */

type Row = Record<string, unknown>

const text = (value: unknown): string => (typeof value === "string" ? value : "")

const textsOf = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.flatMap((item) => (typeof item === "string" ? [item] : [])) : []

const Block = ({ raw }: { readonly raw: unknown }) => {
  const block = previewBlockOf(raw) as Row
  const type = text(block["type"])
  if (type === "paragraph") {
    return (
      <p className="m-0 text-[15px] leading-7 text-[var(--console-ink)]">{text(block["text"])}</p>
    )
  }
  if (type === "heading") {
    const level = Number(block["level"])
    const size = level <= 2 ? "text-2xl" : level === 3 ? "text-xl" : "text-lg"
    return (
      <p className={`m-0 pt-2 font-bold tracking-tight text-[var(--console-ink)] ${size}`}>
        {text(block["text"])}
      </p>
    )
  }
  if (type === "list") {
    const items = textsOf(block["items"])
    return (
      <ul className="m-0 grid list-disc gap-1.5 pl-6 text-[15px] leading-7 text-[var(--console-ink)]">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    )
  }
  if (type === "table") {
    const columns = textsOf(block["columns"])
    const rows = Array.isArray(block["rows"])
      ? block["rows"].map((row) => textsOf((row as Row)["cells"]))
      : []
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  className="border-b border-[var(--console-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--console-ink-muted)]"
                  key={index}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, rowIndex) => (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => (
                  <td
                    className="border-b border-[var(--console-border)] px-3 py-2 text-[var(--console-ink)]"
                    key={cellIndex}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (type === "faq") {
    const items = Array.isArray(block["items"]) ? block["items"].map((item) => item as Row) : []
    return (
      <dl className="m-0 grid gap-3">
        {items.map((item, index) => (
          <div className="rounded-xl bg-[var(--console-surface-muted)] p-4" key={index}>
            <dt className="m-0 text-sm font-bold text-[var(--console-ink)]">
              {text(item["question"])}
            </dt>
            <dd className="m-0 pt-1.5 text-sm leading-6 text-[var(--console-ink-muted)]">
              {text(item["answer"])}
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  if (type === "quote") {
    return (
      <blockquote className="m-0 border-l-4 border-indigo-300 pl-4 text-[15px] italic leading-7 text-[var(--console-ink)]">
        {text(block["text"])}
        {text(block["attribution"]).length > 0 && (
          <footer className="mt-1 text-xs not-italic text-[var(--console-ink-muted)]">
            —— {text(block["attribution"])}
          </footer>
        )}
      </blockquote>
    )
  }
  if (type === "callout") {
    return (
      <aside className="m-0 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-[15px] leading-7 text-indigo-900">
        {text(block["title"]).length > 0 && (
          <strong className="block pb-1">{text(block["title"])}</strong>
        )}
        {text(block["text"])}
      </aside>
    )
  }
  if (type === "code") {
    return (
      <pre className="m-0 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs leading-6 text-slate-100">
        <code>{text(block["code"])}</code>
      </pre>
    )
  }
  if (type === "image") {
    const src = text(block["src"])
    return (
      <figure className="m-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={text(block["alt"])}
          className="max-h-[420px] w-full rounded-xl object-cover"
          src={src}
        />
        {text(block["caption"]).length > 0 && (
          <figcaption className="pt-2 text-center text-xs text-[var(--console-ink-muted)]">
            {text(block["caption"])}
          </figcaption>
        )}
      </figure>
    )
  }
  if (type === "video") {
    return (
      <p className="m-0 rounded-xl border border-dashed border-[var(--console-border)] p-4 text-sm text-[var(--console-ink-muted)]">
        视频块：{text(block["title"])}（{text(block["src"])}）
      </p>
    )
  }
  if (type === "embed") {
    return (
      <p className="m-0 rounded-xl border border-dashed border-[var(--console-border)] p-4 text-sm text-[var(--console-ink-muted)]">
        嵌入块：{text(block["title"])}（{text(block["provider"])}）
      </p>
    )
  }
  if (type === "references") {
    const items = Array.isArray(block["items"]) ? block["items"].map((item) => item as Row) : []
    return (
      <ul className="m-0 grid list-none gap-1 p-0 text-sm text-[var(--console-ink-muted)]">
        {items.map((item, index) => (
          <li key={index}>· {text(item["label"])}</li>
        ))}
      </ul>
    )
  }
  return null
}

export const ArticleBody = ({ body }: { readonly body: unknown }) => {
  if (!Array.isArray(body) || body.length === 0) {
    return (
      <p className="m-0 rounded-xl border border-dashed border-[var(--console-border)] p-6 text-center text-sm text-[var(--console-ink-muted)]">
        该稿件暂无正文内容。
      </p>
    )
  }
  return (
    <div className="grid gap-5">
      {body.map((raw, index) => (
        <Block key={index} raw={raw} />
      ))}
    </div>
  )
}

export default ArticleBody
