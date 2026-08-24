"use client"

import { useAuth } from "@payloadcms/ui"
import { useEffect, useState } from "react"
import type { DefaultCellComponentProps } from "payload"

import { siteHrefOf, siteReferenceOf } from "./site-cell-model"

type Resolution = "idle" | "loading" | "unavailable"

const siteNameRequests = new Map<string, Promise<string | null>>()

const siteNameFromResponse = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const name = (value as Record<string, unknown>)["name"]
  return typeof name === "string" && name.length > 0 ? name : null
}

/**
 * Payload's default relationship cell may defer its resolver indefinitely when
 * a list is server-rendered. Resolve this visible Site relationship in the
 * viewer's own session, so the request remains tenant- and role-scoped.
 */
export const SiteCell = ({ cellData }: DefaultCellComponentProps) => {
  const { user } = useAuth()
  const reference = siteReferenceOf(cellData)
  const [name, setName] = useState(reference.name)
  const [resolution, setResolution] = useState<Resolution>(reference.name === null ? "idle" : "loading")

  useEffect(() => {
    setName(reference.name)
    if (reference.id === null || reference.name !== null) {
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
      siteNameRequests.get(key) ??
      fetch(`/api/sites/${encodeURIComponent(String(reference.id))}?depth=0`, {
        credentials: "same-origin",
      })
        .then(async (response) => (response.ok ? siteNameFromResponse(await response.json()) : null))
        .catch(() => null)
    siteNameRequests.set(key, request)

    let active = true
    setResolution("loading")
    void request.then((resolvedName) => {
      if (active) {
        setName(resolvedName)
        setResolution(resolvedName === null ? "unavailable" : "idle")
      }
    })

    return () => {
      active = false
    }
  }, [reference.id, reference.name, user])

  if (reference.id === null) {
    return <span>—</span>
  }
  if (name !== null) {
    return <a href={siteHrefOf(reference.id)}>{name}</a>
  }
  if (resolution === "loading") {
    return <span>Loading site…</span>
  }
  return <span>{`Site ${String(reference.id)} unavailable`}</span>
}
