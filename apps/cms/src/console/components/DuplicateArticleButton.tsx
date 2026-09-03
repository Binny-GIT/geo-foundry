"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { CopyIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

/*
 * 复制文章为新草稿：整篇复制当前稿件为一份新的草稿并跳转过去（同主题、
 * 同站点分配），原稿保持不动。
 */
const DuplicateArticleButton = ({ editionId }: { readonly editionId: number }) => {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const duplicate = async () => {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/editions/${editionId}/duplicate`, {
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const result = (await response.json().catch(() => ({}))) as {
        readonly editionId?: number
        readonly error?: { readonly code?: unknown }
      }
      if (!response.ok || typeof result.editionId !== "number") {
        throw new Error(
          typeof result.error?.code === "string"
            ? `复制失败（${result.error.code}），请刷新后重试。`
            : "复制失败，请刷新后重试。",
        )
      }
      router.push(consoleDetailHref(result.editionId))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "复制失败，请刷新后重试。")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button
        className="gf-console-focus disabled:cursor-wait"
        disabled={pending}
        onClick={() => void duplicate()}
        size="sm"
        type="button"
        variant="secondary"
      >
        <CopyIcon size={15} />
        {pending ? "复制中…" : "复制为新草稿"}
      </Button>
      {error !== null && (
        <p className="m-0 self-center text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

const consoleDetailHref = (id: number): string =>
  `/admin/collections/content-editions/${String(id)}`

export default DuplicateArticleButton
