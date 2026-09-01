import { type HasLanguage, uiLangOf } from "../i18n/ui-lang"
import { mediaUploadGuidanceOf } from "./media-upload-guidance-model"

export type MediaUploadGuidanceProps = {
  readonly i18n?: HasLanguage
}

/**
 * A small, read-only companion to the stock Media registry. The registry keeps
 * Payload's filters, pagination, bulk actions, and tenant-scoped permissions.
 */
export const MediaUploadGuidance = ({ i18n }: MediaUploadGuidanceProps) => {
  const guidance = mediaUploadGuidanceOf(uiLangOf(i18n?.language))

  return (
    <section className="mx-auto mb-6 flex max-w-[1440px] flex-col gap-4 rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-5 shadow-[var(--gf-shadow-surface)] sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
          {guidance.kicker}
        </p>
        <h2 className="m-0 mt-1 text-xl font-bold tracking-tight text-[var(--theme-text)]">
          {guidance.title}
        </h2>
        <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-[var(--theme-elevation-600)]">
          {guidance.alt}
        </p>
      </div>
      <dl className="m-0 grid shrink-0 gap-2.5 text-sm sm:min-w-64">
        <div className="rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2.5">
          <dt className="text-xs font-semibold text-[var(--theme-elevation-600)]">
            {guidance.formatsLabel}
          </dt>
          <dd className="m-0 mt-1 font-bold text-[var(--theme-text)]">{guidance.formats}</dd>
        </div>
        <div className="rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2.5">
          <dt className="text-xs font-semibold text-[var(--theme-elevation-600)]">
            {guidance.sizeLabel}
          </dt>
          <dd className="m-0 mt-1 font-bold text-[var(--theme-text)]">{guidance.size}</dd>
        </div>
        <p className="m-0 text-xs leading-5 text-[var(--theme-elevation-600)]">
          {guidance.localOnly}
        </p>
      </dl>
    </section>
  )
}
