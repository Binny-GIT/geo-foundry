"use client"

import { useAuth, useTranslation } from "@payloadcms/ui"
import type { DefaultCellComponentProps } from "payload"
import { useEffect, useState } from "react"

import { uiLangOf } from "../i18n/ui-lang"
import { editionHrefOf, editionReferenceOf } from "./edition-cell-model"

const TEXT = {
  en: {
    loading: "Loading edition…",
    unavailable: (id: string | number) => `Edition ${String(id)} unavailable`,
  },
  zh: {
    loading: "正在加载内容版本…",
    unavailable: (id: string | number) => `内容版本 ${String(id)} 不可用`,
  },
} as const

type Resolution = "idle" | "loading" | "unavailable"

const editionTitleRequests = new Map<string, Promise<string | null>>()

const editionTitleFromResponse = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) return null
  const title = (value as Record<string, unknown>)["title"]
  return typeof title === "string" && title.length > 0 ? title : null
}

export const EditionCell = ({ cellData }: DefaultCellComponentProps) => {
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const t = TEXT[uiLangOf(i18n.language)]
  const reference = editionReferenceOf(cellData)
  const [title, setTitle] = useState(reference.title)
  const [resolution, setResolution] = useState<Resolution>(
    reference.title === null ? "idle" : "loading",
  )

  useEffect(() => {
    setTitle(reference.title)
    if (reference.id === null || reference.title !== null) {
      setResolution("idle")
      return
    }

    const userId = user?.["id"]
    if (typeof userId !== "number" && typeof userId !== "string") {
      setResolution("unavailable")
      return
    }

    const key = `${String(userId)}:${String(reference.id)}`
    const request =
      editionTitleRequests.get(key) ??
      fetch(
        `/api/content-editions/${encodeURIComponent(String(reference.id))}?depth=0&draft=true`,
        { credentials: "same-origin" },
      )
        .then(async (response) =>
          response.ok ? editionTitleFromResponse(await response.json()) : null,
        )
        .catch(() => null)
    editionTitleRequests.set(key, request)

    let active = true
    setResolution("loading")
    void request.then((resolvedTitle) => {
      if (active) {
        setTitle(resolvedTitle)
        setResolution(resolvedTitle === null ? "unavailable" : "idle")
      }
    })

    return () => {
      active = false
    }
  }, [reference.id, reference.title, user])

  if (reference.id === null) return <span>—</span>
  if (title !== null) return <a className="no-underline" href={editionHrefOf(reference.id)}>{title}</a>
  if (resolution === "loading") return <span>{t.loading}</span>
  return <span>{t.unavailable(reference.id)}</span>
}
