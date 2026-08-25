/*
 * Language picker for custom admin chrome. Payload's own components
 * translate through `t()` + supportedLanguages, but our custom views carry
 * product copy that has no Payload translation keys — they get a per-file
 * zh/en dictionary instead and resolve it through this helper. Everything
 * defaults to zh, matching payload.config.ts `i18n.fallbackLanguage`.
 */
export type UiLang = "en" | "zh"

export const uiLangOf = (language: unknown): UiLang => (language === "en" ? "en" : "zh")

/** Structural slice of ServerProps.i18n / useTranslation().i18n we rely on. */
export type HasLanguage = {
  readonly language?: unknown
}
