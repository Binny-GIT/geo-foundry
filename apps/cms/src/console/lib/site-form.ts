export type SiteStatus = "active" | "disabled"

type SiteContentStrategy = {
  readonly contentAngles: readonly string[]
  readonly cta: string
  readonly expertise: readonly string[]
  readonly language: string
  readonly positioning: string
  readonly preferredTopics: readonly string[]
  readonly prohibitedExpressions: readonly string[]
  readonly prohibitedTopics: readonly string[]
  readonly targetAudience: readonly string[]
  readonly tone: string
}

type SiteQualityThresholds = {
  readonly crossDomainBlock: string
  readonly crossDomainReview: string
  readonly dimensionMinimum: string
  readonly overallMinimum: string
  readonly sameSiteTitleBlock: string
}

type SiteSeoDefaults = {
  readonly defaultDescription: string
  readonly titleSuffix: string
}

export type SiteFormValues = {
  readonly contentStrategy: SiteContentStrategy
  readonly locale: string
  readonly name: string
  readonly qualityThresholds: SiteQualityThresholds
  readonly seoDefaults: SiteSeoDefaults
  readonly status: SiteStatus
  readonly timezone: string
}

export type SiteMutationPayload = {
  readonly contentStrategy: {
    readonly contentAngles: string[]
    readonly cta: string | null
    readonly expertise: string[]
    readonly language: string | null
    readonly positioning: string | null
    readonly preferredTopics: string[]
    readonly prohibitedExpressions: string[]
    readonly prohibitedTopics: string[]
    readonly targetAudience: string[]
    readonly tone: string | null
  }
  readonly locale: string
  readonly name: string
  readonly qualityThresholds: {
    readonly crossDomainBlock: number
    readonly crossDomainReview: number
    readonly dimensionMinimum: number
    readonly overallMinimum: number
    readonly sameSiteTitleBlock: number
  }
  readonly seoDefaults: {
    readonly defaultDescription: string | null
    readonly titleSuffix: string | null
  }
  readonly status: SiteStatus
  readonly timezone: string
}

export type SiteFormResult =
  | { readonly data: SiteMutationPayload; readonly ok: true }
  | { readonly errors: readonly string[]; readonly ok: false }

type RecordLike = Record<string, unknown>

type ContentStrategyDocument = {
  readonly contentAngles?: unknown
  readonly cta?: unknown
  readonly expertise?: unknown
  readonly language?: unknown
  readonly positioning?: unknown
  readonly preferredTopics?: unknown
  readonly prohibitedExpressions?: unknown
  readonly prohibitedTopics?: unknown
  readonly targetAudience?: unknown
  readonly tone?: unknown
}

type QualityThresholdsDocument = {
  readonly crossDomainBlock?: unknown
  readonly crossDomainReview?: unknown
  readonly dimensionMinimum?: unknown
  readonly overallMinimum?: unknown
  readonly sameSiteTitleBlock?: unknown
}

type SeoDefaultsDocument = {
  readonly defaultDescription?: unknown
  readonly titleSuffix?: unknown
}

type SiteDocument = {
  readonly contentStrategy?: unknown
  readonly locale?: unknown
  readonly name?: unknown
  readonly qualityThresholds?: unknown
  readonly seoDefaults?: unknown
  readonly status?: unknown
  readonly timezone?: unknown
}

const DEFAULT_QUALITY_THRESHOLDS: SiteQualityThresholds = {
  crossDomainBlock: "0.92",
  crossDomainReview: "0.85",
  dimensionMinimum: "75",
  overallMinimum: "80",
  sameSiteTitleBlock: "0.9",
}

const emptyContentStrategy = (): SiteContentStrategy => ({
  contentAngles: [],
  cta: "",
  expertise: [],
  language: "",
  positioning: "",
  preferredTopics: [],
  prohibitedExpressions: [],
  prohibitedTopics: [],
  targetAudience: [],
  tone: "",
})

export const DEFAULT_SITE_FORM_VALUES: SiteFormValues = {
  contentStrategy: emptyContentStrategy(),
  locale: "en-US",
  name: "",
  qualityThresholds: DEFAULT_QUALITY_THRESHOLDS,
  seoDefaults: {
    defaultDescription: "",
    titleSuffix: "",
  },
  status: "active",
  timezone: "America/New_York",
}

const stringValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    : []

const recordValue = <T extends object>(value: unknown): T =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as T) : ({} as T)

const numberString = (value: unknown, fallback: string): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : fallback

const optionalText = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const listValues = (values: readonly string[]): string[] =>
  values.map((value) => value.trim()).filter((value) => value.length > 0)

const parseThreshold = (
  errors: string[],
  label: string,
  value: string,
  minimum: number,
  maximum: number,
): number | null => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    errors.push(`${label} must be between ${minimum} and ${maximum}.`)
    return null
  }
  return parsed
}

export const siteFormValuesFromDocument = (
  document: RecordLike | null | undefined,
): SiteFormValues => {
  const site = document as SiteDocument | null | undefined
  const contentStrategy = recordValue<ContentStrategyDocument>(site?.contentStrategy)
  const qualityThresholds = recordValue<QualityThresholdsDocument>(site?.qualityThresholds)
  const seoDefaults = recordValue<SeoDefaultsDocument>(site?.seoDefaults)
  const status = site?.status

  return {
    contentStrategy: {
      contentAngles: stringArray(contentStrategy.contentAngles),
      cta: stringValue(contentStrategy.cta),
      expertise: stringArray(contentStrategy.expertise),
      language: stringValue(contentStrategy["language"]),
      positioning: stringValue(contentStrategy["positioning"]),
      preferredTopics: stringArray(contentStrategy.preferredTopics),
      prohibitedExpressions: stringArray(contentStrategy.prohibitedExpressions),
      prohibitedTopics: stringArray(contentStrategy.prohibitedTopics),
      targetAudience: stringArray(contentStrategy.targetAudience),
      tone: stringValue(contentStrategy.tone),
    },
    locale: stringValue(site?.["locale"], DEFAULT_SITE_FORM_VALUES.locale),
    name: stringValue(site?.["name"]),
    qualityThresholds: {
      crossDomainBlock: numberString(
        qualityThresholds.crossDomainBlock,
        DEFAULT_QUALITY_THRESHOLDS.crossDomainBlock,
      ),
      crossDomainReview: numberString(
        qualityThresholds.crossDomainReview,
        DEFAULT_QUALITY_THRESHOLDS.crossDomainReview,
      ),
      dimensionMinimum: numberString(
        qualityThresholds.dimensionMinimum,
        DEFAULT_QUALITY_THRESHOLDS.dimensionMinimum,
      ),
      overallMinimum: numberString(
        qualityThresholds.overallMinimum,
        DEFAULT_QUALITY_THRESHOLDS.overallMinimum,
      ),
      sameSiteTitleBlock: numberString(
        qualityThresholds.sameSiteTitleBlock,
        DEFAULT_QUALITY_THRESHOLDS.sameSiteTitleBlock,
      ),
    },
    seoDefaults: {
      defaultDescription: stringValue(seoDefaults.defaultDescription),
      titleSuffix: stringValue(seoDefaults.titleSuffix),
    },
    status: status === "disabled" ? "disabled" : "active",
    timezone: stringValue(site?.["timezone"], DEFAULT_SITE_FORM_VALUES.timezone),
  }
}

/** Maps the only fields editable in the Console Sites form. Tenant is deliberately absent. */
export const siteMutationPayload = (values: SiteFormValues): SiteFormResult => {
  const errors: string[] = []
  const name = values.name.trim()
  const locale = values.locale.trim()
  const timezone = values.timezone.trim()

  if (name.length === 0) errors.push("Name is required.")
  if (locale.length === 0) errors.push("Locale is required.")
  if (timezone.length === 0) errors.push("Timezone is required.")
  if (values.status !== "active" && values.status !== "disabled") {
    errors.push("Status must be active or disabled.")
  }

  const crossDomainBlock = parseThreshold(
    errors,
    "Cross-domain block",
    values.qualityThresholds.crossDomainBlock,
    0,
    1,
  )
  const crossDomainReview = parseThreshold(
    errors,
    "Cross-domain review",
    values.qualityThresholds.crossDomainReview,
    0,
    1,
  )
  const sameSiteTitleBlock = parseThreshold(
    errors,
    "Same-site title block",
    values.qualityThresholds.sameSiteTitleBlock,
    0,
    1,
  )
  const overallMinimum = parseThreshold(
    errors,
    "Overall minimum",
    values.qualityThresholds.overallMinimum,
    0,
    100,
  )
  const dimensionMinimum = parseThreshold(
    errors,
    "Dimension minimum",
    values.qualityThresholds.dimensionMinimum,
    0,
    100,
  )

  if (
    errors.length > 0 ||
    crossDomainBlock === null ||
    crossDomainReview === null ||
    sameSiteTitleBlock === null ||
    overallMinimum === null ||
    dimensionMinimum === null
  ) {
    return { errors, ok: false }
  }

  return {
    data: {
      contentStrategy: {
        contentAngles: listValues(values.contentStrategy.contentAngles),
        cta: optionalText(values.contentStrategy.cta),
        expertise: listValues(values.contentStrategy.expertise),
        language: optionalText(values.contentStrategy.language),
        positioning: optionalText(values.contentStrategy.positioning),
        preferredTopics: listValues(values.contentStrategy.preferredTopics),
        prohibitedExpressions: listValues(values.contentStrategy.prohibitedExpressions),
        prohibitedTopics: listValues(values.contentStrategy.prohibitedTopics),
        targetAudience: listValues(values.contentStrategy.targetAudience),
        tone: optionalText(values.contentStrategy.tone),
      },
      locale,
      name,
      qualityThresholds: {
        crossDomainBlock,
        crossDomainReview,
        dimensionMinimum,
        overallMinimum,
        sameSiteTitleBlock,
      },
      seoDefaults: {
        defaultDescription: optionalText(values.seoDefaults.defaultDescription),
        titleSuffix: optionalText(values.seoDefaults.titleSuffix),
      },
      status: values.status,
      timezone,
    },
    ok: true,
  }
}
