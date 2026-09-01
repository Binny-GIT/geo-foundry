"use client"

import { useState } from "react"

import { ImportIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

import { consoleRoute } from "../lib/resources"

type PayloadError = {
  readonly errors?: readonly { readonly message?: string }[]
  readonly message?: string
}

const messageFor = (payload: PayloadError): string => {
  const raw =
    payload.errors?.find((error) => typeof error.message === "string")?.message ?? payload.message
  if (raw?.includes("CMS_MEDIA_FILE_TOO_LARGE")) return "文件超过 5 MB 限制。"
  if (raw?.includes("CMS_MEDIA_TYPE_UNSUPPORTED")) return "只支持 PNG、JPEG、WebP 和 GIF 图片。"
  return raw ?? "上传失败，请检查文件和替代文本后重试。"
}

export const ConsoleMediaUploadForm = () => {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0) {
      setError("请选择要上传的图片文件。")
      return
    }
    setError(null)
    setLoading(true)
    try {
      const response = await fetch("/api/media", {
        body: form,
        credentials: "same-origin",
        method: "POST",
      })
      const payload = (await response.json().catch(() => ({}))) as PayloadError & {
        readonly doc?: { readonly id?: string | number }
      }
      if (!response.ok) {
        setError(messageFor(payload))
        return
      }
      const id = payload.doc?.id
      window.location.assign(
        id === undefined || id === null
          ? consoleRoute.collection("media")
          : consoleRoute.document("media", id),
      )
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="grid gap-5" encType="multipart/form-data" method="post" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        图片文件
        <input
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="gf-console-focus min-h-28 rounded-xl border border-dashed border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 py-4 text-sm text-[var(--console-ink)] file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-700"
          name="file"
          onChange={(event) => setSelected(event.target.files?.[0]?.name ?? null)}
          required
          type="file"
        />
        <small className="font-normal leading-5 text-[var(--console-ink-muted)]">
          仅本地文件；PNG、JPEG、WebP 或 GIF，最大 5 MB。不能通过 URL 导入。
        </small>
      </label>
      {selected !== null && (
        <p className="m-0 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 py-2 text-sm text-[var(--console-ink-muted)]">
          已选择：{selected}
        </p>
      )}
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        替代文本
        <input
          className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
          name="alt"
          placeholder="描述图片内容，供无障碍阅读使用"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        图片说明（可选）
        <textarea
          className="gf-console-focus min-h-24 resize-y rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 py-3 text-base leading-6 text-[var(--console-ink)] outline-none"
          name="caption"
          placeholder="可选的展示说明"
        />
      </label>
      {error !== null && (
        <p
          className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-6 text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--console-border)] pt-5">
        <Button asChild size="lg" variant="secondary">
          <a href={consoleRoute.collection("media")}>取消</a>
        </Button>
        <Button className="disabled:cursor-wait" disabled={loading} size="lg" type="submit">
          <ImportIcon size={15} />
          {loading ? "正在上传…" : "上传媒体"}
        </Button>
      </div>
    </form>
  )
}
