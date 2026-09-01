import { type HasLanguage, uiLangOf } from "../i18n/ui-lang"

type LoginIntroProps = {
  /** Passed by Payload's login view (ServerProps slice); defaults to zh. */
  readonly i18n?: HasLanguage
}

const TEXT = {
  en: {
    heading: "Content Operations Center",
    intro: "Sign in to manage content editions, quality review, publishing, and distribution.",
  },
  zh: {
    heading: "内容运营中心",
    intro: "登录以管理内容版本、质量审核、发布与分发。",
  },
}

export const LoginIntro = ({ i18n }: LoginIntroProps) => {
  const t = TEXT[uiLangOf(i18n?.language)]
  return (
    <div className="mb-7 border-b border-[var(--gf-border)] pb-6">
      <p className="m-0 mb-1.5 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
        Geo Foundry
      </p>
      <h1 className="m-0 text-[28px] font-semibold leading-[1.15] tracking-tight text-[var(--theme-text)]">
        {t.heading}
      </h1>
      <p className="m-0 mt-2.5 leading-relaxed text-[var(--theme-elevation-600)]">{t.intro}</p>
    </div>
  )
}
