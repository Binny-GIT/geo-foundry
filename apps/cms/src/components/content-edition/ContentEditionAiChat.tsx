"use client"

import { useDocumentInfo, useField } from "@payloadcms/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  FilePlusIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SendIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/icons"
import { IconBadge } from "../ui"
import { Button } from "../ui/button"

const PANEL_KEY = "gf-ai-chat-open"
const conversationKeyOf = (editionId: string) => `gf-ai-chat:${editionId}`

export type AiChatMessage = Readonly<{
  content: string
  createdAt: string
  id: string
  role: "assistant" | "system" | "user"
}>

const isMessage = (value: unknown): value is AiChatMessage => {
  if (typeof value !== "object" || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row["content"] === "string" &&
    typeof row["createdAt"] === "string" &&
    typeof row["id"] === "string" &&
    (row["role"] === "assistant" || row["role"] === "system" || row["role"] === "user")
  )
}

/**
 * Panel open state lives in the browser so the editor keeps their preferred
 * workspace width across documents and sessions. The initial render always
 * uses the collapsed-safe default and adopts the stored value after mount,
 * which keeps the server and first client render identical.
 */
export const useAiChatPanel = (): readonly [boolean, (next: boolean) => void] => {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    const stored = window.localStorage.getItem(PANEL_KEY)
    if (stored === "closed") setOpen(false)
  }, [])
  const update = useCallback((next: boolean) => {
    setOpen(next)
    window.localStorage.setItem(PANEL_KEY, next ? "open" : "closed")
  }, [])
  return [open, update]
}

const ERROR_TEXT: Record<string, string> = {
  AI_CHAT_BODY_INVALID: "对话内容不合法，请缩短后重试。",
  AI_CHAT_NOT_FOUND: "无法读取当前稿件，请刷新后重试。",
  AI_CHAT_UNAUTHENTICATED: "登录状态已失效，请重新登录。",
  AI_CHAT_UNCONFIGURED:
    "AI 服务尚未配置：请在部署环境设置 AI_PROVIDER=openai-compatible、AI_BASE_URL、AI_CHAT_MODEL 和 AI_API_KEY 后再使用。对话记录已保留。",
  AI_CHAT_UPSTREAM_FAILED: "AI 服务调用失败，请稍后重试。",
}

const blocksOf = (reply: string): Record<string, unknown>[] =>
  reply
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith("#")
        ? { blockType: "heading", level: "2", text: part.replace(/^#+\s*/, "") }
        : { blockType: "paragraph", text: part },
    )

export const ContentEditionAiChat = ({
  onCollapse,
  readOnly,
}: {
  readonly onCollapse: () => void
  readonly readOnly: boolean
}) => {
  const { id } = useDocumentInfo()
  const editionId = id === undefined || id === null ? "new" : String(id)
  const { setValue: setBody, value: body } = useField<unknown[]>({ path: "body" })
  const [messages, setMessages] = useState<readonly AiChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setHydrated(false)
    try {
      const stored = window.localStorage.getItem(conversationKeyOf(editionId))
      const parsed: unknown = stored === null ? [] : JSON.parse(stored)
      setMessages(Array.isArray(parsed) ? parsed.filter(isMessage) : [])
    } catch {
      setMessages([])
    }
    setHydrated(true)
  }, [editionId])

  useEffect(() => {
    if (!hydrated) return
    window.localStorage.setItem(conversationKeyOf(editionId), JSON.stringify(messages))
    scroller.current?.scrollTo({ behavior: "smooth", top: scroller.current.scrollHeight })
  }, [editionId, hydrated, messages])

  const append = (message: Omit<AiChatMessage, "createdAt" | "id">) =>
    setMessages((current) => [
      ...current,
      { ...message, createdAt: new Date().toISOString(), id: crypto.randomUUID() },
    ])

  const send = async () => {
    const text = draft.trim()
    if (text.length === 0 || sending) return
    const history = [...messages, { content: text, createdAt: "", id: "", role: "user" as const }]
    append({ content: text, role: "user" })
    setDraft("")
    setSending(true)
    try {
      const response = await fetch(`/api/editions/${editionId}/ai-chat`, {
        body: JSON.stringify({
          messages: history
            .filter((message) => message.role !== "system")
            .slice(-20)
            .map((message) => ({ content: message.content, role: message.role })),
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { code?: string }
        reply?: unknown
      }
      if (!response.ok || typeof payload.reply !== "string") {
        append({
          content:
            ERROR_TEXT[payload.error?.code ?? ""] ??
            `AI 服务返回错误（${payload.error?.code ?? response.status}）。`,
          role: "system",
        })
        return
      }
      append({ content: payload.reply, role: "assistant" })
    } catch {
      append({ content: "网络异常，未能发送到 AI 服务。", role: "system" })
    } finally {
      setSending(false)
    }
  }

  const insert = (content: string) => {
    const next = blocksOf(content)
    if (next.length === 0) return
    const current = Array.isArray(body) ? body : []
    setBody([...(JSON.parse(JSON.stringify(current)) as unknown[]), ...next])
  }

  return (
    <aside
      aria-label="AI 写作助手"
      className="flex min-w-0 flex-col gap-0 self-start rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] shadow-[var(--gf-shadow-surface)]"
    >
      <header className="flex items-center gap-3 border-b border-[var(--theme-elevation-150)] px-4 py-3">
        <IconBadge tone="accent">
          <SparklesIcon size={18} />
        </IconBadge>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
            AI 助手
          </p>
          <strong className="mt-0.5 block truncate text-sm text-[var(--theme-text)]">
            写作对话
          </strong>
        </div>
        <Button
          aria-label="清空对话"
          disabled={messages.length === 0}
          onClick={() => setMessages([])}
          size="icon-sm"
          title="清空对话"
          type="button"
          variant="ghost"
        >
          <TrashIcon size={15} />
        </Button>
        <Button
          aria-label="收起 AI 助手"
          onClick={onCollapse}
          size="icon-sm"
          title="收起"
          type="button"
          variant="ghost"
        >
          <PanelLeftCloseIcon size={15} />
        </Button>
      </header>

      <div
        className="flex max-h-[min(60vh,640px)] min-h-40 flex-col gap-3 overflow-y-auto px-4 py-4"
        ref={scroller}
      >
        {messages.length === 0 ? (
          <p className="m-0 text-sm leading-6 text-[var(--theme-elevation-600)]">
            向助手描述你的写作意图，例如“帮我基于当前摘要写三段引言”。对话记录只保存在本浏览器，可随时清空。
          </p>
        ) : (
          messages.map((message) => (
            <article
              className={
                message.role === "user"
                  ? "self-end rounded-2xl rounded-br-sm bg-[var(--gf-tone-accent-bg)] px-3 py-2 text-sm leading-6 text-[var(--theme-text)]"
                  : message.role === "system"
                    ? "rounded-2xl border border-[var(--gf-tone-warning-fg)] bg-[var(--gf-tone-warning-bg)] px-3 py-2 text-sm leading-6 text-[var(--gf-tone-warning-fg)]"
                    : "rounded-2xl rounded-bl-sm border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] px-3 py-2 text-sm leading-6 text-[var(--theme-text)]"
              }
              key={message.id}
            >
              <p className="m-0 whitespace-pre-wrap break-words">{message.content}</p>
              {message.role === "assistant" && !readOnly && (
                <Button
                  className="mt-2"
                  onClick={() => insert(message.content)}
                  size="xs"
                  type="button"
                  variant="secondary"
                >
                  <FilePlusIcon size={13} /> 插入正文
                </Button>
              )}
            </article>
          ))
        )}
        {sending && (
          <p className="m-0 text-xs text-[var(--theme-elevation-600)]">助手正在生成回复…</p>
        )}
      </div>

      <div className="border-t border-[var(--theme-elevation-150)] px-4 py-3">
        <textarea
          aria-label="向 AI 助手提问"
          className="min-h-20 w-full resize-y rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-3 text-sm leading-6 text-[var(--theme-text)] outline-none focus:border-[var(--gf-accent-400)] focus:ring-2 focus:ring-[var(--gf-accent-200)]"
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder="描述你的写作需求，Ctrl/⌘ + Enter 发送"
          value={draft}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--theme-elevation-600)]">
            {messages.length} 条记录
          </span>
          <Button
            disabled={draft.trim().length === 0 || sending}
            onClick={() => void send()}
            size="sm"
            type="button"
          >
            <SendIcon size={14} /> {sending ? "发送中…" : "发送"}
          </Button>
        </div>
      </div>
    </aside>
  )
}

export const ContentEditionAiChatRail = ({ onExpand }: { readonly onExpand: () => void }) => (
  <div className="flex flex-row items-center gap-2 rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-2 shadow-[var(--gf-shadow-surface)] 2xl:flex-col 2xl:self-start 2xl:py-3">
    <Button
      aria-label="展开 AI 助手"
      onClick={onExpand}
      size="icon-sm"
      title="展开 AI 助手"
      type="button"
      variant="ghost"
    >
      <PanelLeftOpenIcon size={16} />
    </Button>
    <SparklesIcon size={16} />
    <span className="text-xs font-bold text-[var(--theme-elevation-600)] 2xl:[writing-mode:vertical-rl]">
      AI 助手
    </span>
  </div>
)
