/*
 * 稿源输入规范化（纯函数）：URL 归一化、渠道必填校验、标题/摘要整理。
 * 数据库读写在 server/routes/intake-ops.ts 与 server/repositories/intake-fetch.ts。
 */

export type IntakeChannel = "manual" | "url" | "webhook" | "rss"

type IntakeId = number

export type IntakeInput = {
  readonly bodyMarkdown?: string
  readonly channel: IntakeChannel
  readonly connectorId?: IntakeId
  readonly contentHash?: string
  readonly sourceUrl?: string
  readonly suggestedSiteId?: IntakeId
  readonly summary?: string
  readonly tenantId: number
  readonly title: string
}

export type NormalizedIntakeInput = Readonly<{
  readonly bodyMarkdown?: string
  channel: IntakeChannel
  readonly connectorId?: IntakeId
  readonly contentHash?: string
  readonly normalizedUrl?: string
  readonly sourceUrl?: string
  readonly suggestedSiteId?: IntakeId
  readonly summary?: string
  readonly tenantId: number
  readonly title: string
}>

export class IntakeError extends Error {
  override readonly name = "IntakeError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

const fail = (code: string, detail?: string): IntakeError => new IntakeError(code, detail)

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized.length > 0 ? normalized : undefined
}

const normalizedHash = (value: string | undefined): string | undefined => {
  const normalized = text(value)?.toLocaleLowerCase()
  return normalized === undefined ? undefined : normalized
}

/** Removes URL fragments and tracking parameters without making any network request. */
export const normalizeIntakeUrl = (value: string | undefined): string | undefined => {
  const sourceUrl = text(value)
  if (sourceUrl === undefined) return undefined

  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    throw fail("INTAKE_URL_INVALID", sourceUrl)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fail("INTAKE_URL_PROTOCOL_INVALID", url.protocol)
  }

  url.protocol = url.protocol.toLowerCase()
  url.hostname = url.hostname.toLowerCase()
  url.hash = ""
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_[^=]*|fbclid|gclid|mc_[^=]*)$/i.test(key)) {
      url.searchParams.delete(key)
    }
  }
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = ""
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "")
  return url.toString()
}

const normalizeForChannel = (
  channel: IntakeChannel,
  input: Omit<IntakeInput, "channel">,
): NormalizedIntakeInput => {
  const title = text(input.title)
  if (title === undefined) throw fail("INTAKE_TITLE_REQUIRED")
  const sourceUrl = text(input.sourceUrl)
  if (channel === "url" && sourceUrl === undefined) throw fail("INTAKE_SOURCE_URL_REQUIRED")
  if (channel === "rss" && input.connectorId === undefined) {
    throw fail("INTAKE_CONNECTOR_REQUIRED")
  }
  /*
   * webhook 是外部工具的直投通道：内容已经在请求体里，不需要 connector，
   * 但必须带 suggestedSiteId —— 否则条目进了稿源箱，Console 的采纳操作
   * 解析不出目标站点，等于白投。
   */
  if (channel === "webhook") {
    if (input.suggestedSiteId === undefined) throw fail("INTAKE_SUGGESTED_SITE_REQUIRED")
    if (input.bodyMarkdown !== undefined && input.bodyMarkdown.trim().length === 0) {
      throw fail("INTAKE_BODY_MARKDOWN_EMPTY")
    }
  }
  if (input.bodyMarkdown !== undefined && channel !== "webhook") {
    throw fail("INTAKE_BODY_MARKDOWN_CHANNEL_INVALID")
  }

  const summary = text(input.summary)
  const contentHash = normalizedHash(input.contentHash)
  const normalizedUrl = sourceUrl === undefined ? undefined : normalizeIntakeUrl(sourceUrl)
  return Object.freeze({
    ...(input.bodyMarkdown === undefined ? {} : { bodyMarkdown: input.bodyMarkdown }),
    channel,
    ...(input.connectorId === undefined ? {} : { connectorId: input.connectorId }),
    ...(contentHash === undefined ? {} : { contentHash }),
    ...(normalizedUrl === undefined ? {} : { normalizedUrl }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(input.suggestedSiteId === undefined ? {} : { suggestedSiteId: input.suggestedSiteId }),
    ...(summary === undefined ? {} : { summary }),
    tenantId: input.tenantId,
    title,
  })
}

export const normalizeManualIntakeInput = (
  input: Omit<IntakeInput, "channel">,
): NormalizedIntakeInput => normalizeForChannel("manual", input)

export const normalizeUrlIntakeInput = (
  input: Omit<IntakeInput, "channel">,
): NormalizedIntakeInput => normalizeForChannel("url", input)

export const normalizeWebhookIntakeInput = (
  input: Omit<IntakeInput, "channel">,
): NormalizedIntakeInput => normalizeForChannel("webhook", input)

export const normalizeRssIntakeInput = (
  input: Omit<IntakeInput, "channel">,
): NormalizedIntakeInput => normalizeForChannel("rss", input)

export const normalizeIntakeInput = (input: IntakeInput): NormalizedIntakeInput => {
  const { channel, ...rest } = input
  switch (channel) {
    case "manual":
      return normalizeManualIntakeInput(rest)
    case "url":
      return normalizeUrlIntakeInput(rest)
    case "webhook":
      return normalizeWebhookIntakeInput(rest)
    case "rss":
      return normalizeRssIntakeInput(rest)
  }
}
