"use client"

import { GeoDocumentPage } from "@geo/render-react"
import type { ReactNode } from "react"

import { AlertTriangleIcon } from "../icons"
import { IconBadge } from "../ui"
import { previewDocumentOf, type PreviewSource } from "./page-document-preview-adapter"

export const ContentEditionPreview = ({
  historical,
  source,
}: {
  readonly historical?: boolean
  readonly source: PreviewSource
}): ReactNode => {
  const result = previewDocumentOf(source)
  if (!result.ok) {
    return (
      <section className="rounded-2xl border border-[var(--gf-tone-warning-fg)] bg-[var(--gf-tone-warning-bg)] p-5">
        <div className="flex items-start gap-3">
          <IconBadge tone="warning"><AlertTriangleIcon size={18} /></IconBadge>
          <div>
            <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">预览尚未就绪</h2>
            <p className="m-0 mt-1 text-sm leading-6 text-[var(--theme-elevation-700)]">
              请补全正文中标记的问题后再查看预览。
            </p>
            <ul className="m-0 mt-3 list-disc pl-5 text-xs text-[var(--theme-elevation-700)]">
              {result.issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--gf-border)] bg-white shadow-[var(--gf-shadow-surface)]">
      {historical === true && (
        <div className="border-b border-[var(--gf-tone-warning-fg)] bg-[var(--gf-tone-warning-bg)] px-5 py-3 text-sm font-bold text-[var(--gf-tone-warning-fg)]">
          正在预览历史版本；当前草稿不会被修改。
        </div>
      )}
      <div className="gf-edition-preview px-5 py-8 sm:px-9 sm:py-10">
        <GeoDocumentPage
          document={result.document}
          theme={{
            tokens: {
              accentColor: "var(--gf-accent-700)",
              backgroundColor: "#ffffff",
              borderColor: "var(--gf-border)",
              contentWidth: "48rem",
              fontFamily: "var(--gf-font-body)",
              foregroundColor: "var(--theme-text)",
              mutedForegroundColor: "var(--theme-elevation-600)",
              radius: "12px",
              spacing: "1rem",
              surfaceColor: "var(--theme-elevation-50)",
            },
          }}
        />
      </div>
    </section>
  )
}
