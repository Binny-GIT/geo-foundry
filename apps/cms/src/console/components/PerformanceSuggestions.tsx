"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { FilePlusIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

export type PerformanceSuggestion = Readonly<{
  readonly current: number
  readonly editionId: number
  readonly href: string
  readonly previous: number
  readonly site: string
  readonly title: string
}>

export const PerformanceSuggestions = ({
  suggestions,
}: {
  readonly suggestions: readonly PerformanceSuggestion[]
}) => {
  const router = useRouter()
  const [accepted, setAccepted] = useState<readonly number[]>([])
  const [pending, setPending] = useState<number | null>(null)
  const [error, setError] = useState(false)
  const visible = suggestions.filter((suggestion) => !accepted.includes(suggestion.editionId))
  if (visible.length === 0)
    return (
      <p className="m-0 px-5 py-6 text-sm text-[var(--console-ink-muted)]">
        No update suggestions right now.
      </p>
    )
  const accept = async (editionId: number) => {
    setPending(editionId)
    setError(false)
    try {
      const response = await fetch("/api/performance-snapshots/suggestions/accept", {
        body: JSON.stringify({ editionId }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) throw new Error()
      setAccepted((previous) => [...previous, editionId])
      router.refresh()
    } catch {
      setError(true)
    } finally {
      setPending(null)
    }
  }
  return (
    <div className="grid">
      {error && (
        <p className="m-0 border-b border-[var(--console-border)] bg-rose-50/60 px-5 py-2 text-xs text-rose-700 dark:bg-rose-400/10 dark:text-rose-300">
          Could not accept the suggestion. Try again.
        </p>
      )}
      <ul className="m-0 list-none divide-y divide-[var(--console-border)] p-0">
        {visible.map((suggestion) => (
          <li
            key={suggestion.editionId}
            className="flex min-w-0 items-start justify-between gap-3 px-5 py-4"
          >
            <span className="min-w-0">
              <a
                className="gf-console-focus truncate text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-[var(--console-accent)]"
                href={suggestion.href}
              >
                {suggestion.title}
              </a>
              <span className="block pt-1 text-xs text-[var(--console-ink-muted)]">
                {suggestion.site} · visits {suggestion.previous} → {suggestion.current}
              </span>
            </span>
            <Button
              className="shrink-0 text-xs"
              disabled={pending !== null}
              onClick={() => void accept(suggestion.editionId)}
              type="button"
            >
              <FilePlusIcon size={15} />
              {pending === suggestion.editionId ? "Creating draft…" : "Create refresh draft"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
