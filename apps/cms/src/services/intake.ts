import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"

export type IntakeChannel = "manual" | "url" | "webhook" | "rss"

type IntakeId = number

type IntakeRow = {
  readonly id: IntakeId
  readonly tenant: unknown
  readonly title: unknown
  readonly channel?: unknown
  readonly connector?: unknown
  readonly contentBlocks?: unknown
  readonly summary?: unknown
  readonly sourceUrl?: unknown
  readonly normalizedUrl?: unknown
  readonly contentHash?: unknown
  readonly status?: unknown
  readonly suggestedSite?: unknown
}

export type IntakeInput = {
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
  channel: IntakeChannel
  connectorId?: IntakeId
  contentHash?: string
  normalizedUrl?: string
  sourceUrl?: string
  suggestedSiteId?: IntakeId
  summary?: string
  tenantId: number
  title: string
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

const referenceId = (value: unknown): IntakeId | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }
  if (typeof value === "object" && value !== null) {
    return referenceId((value as Record<string, unknown>)["id"])
  }
  return null
}

const sameReference = (left: unknown, right: unknown): boolean => {
  const leftId = referenceId(left)
  const rightId = referenceId(right)
  return leftId !== null && rightId !== null && String(leftId) === String(rightId)
}

const normalizedTitle = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase()

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
  if ((channel === "webhook" || channel === "rss") && input.connectorId === undefined) {
    throw fail("INTAKE_CONNECTOR_REQUIRED")
  }

  const summary = text(input.summary)
  const contentHash = normalizedHash(input.contentHash)
  const normalizedUrl = sourceUrl === undefined ? undefined : normalizeIntakeUrl(sourceUrl)
  return Object.freeze({
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

const actorForTenant = (user: unknown, tenantId: number) => {
  const claims = resolveSessionClaims(user)
  if (claims === null) throw fail("INTAKE_ACTOR_INVALID")
  if (claims.role !== "super-admin" && String(claims.tenantId) !== String(tenantId)) {
    throw fail("INTAKE_TENANT_MISMATCH")
  }
  return claims
}

const editableActorForTenant = (user: unknown, tenantId: number) => {
  const claims = actorForTenant(user, tenantId)
  if (
    claims.role !== "editor" &&
    claims.role !== "tenant-admin" &&
    claims.role !== "content-service"
  ) {
    throw fail("INTAKE_EDITOR_REQUIRED")
  }
  return claims
}

const loadItem = async (payload: Payload, id: IntakeId): Promise<IntakeRow> => {
  try {
    return (await payload.findByID({
      collection: "intake-items",
      depth: 0,
      id,
      overrideAccess: true,
    })) as unknown as IntakeRow
  } catch (error) {
    if ((error as { status?: unknown }).status === 404)
      throw fail("INTAKE_ITEM_NOT_FOUND", String(id))
    throw error
  }
}

const assertItemTenant = (user: unknown, item: IntakeRow) => {
  const tenantId = referenceId(item.tenant)
  if (tenantId === null) throw fail("INTAKE_ITEM_TENANT_INVALID", String(item.id))
  return editableActorForTenant(user, tenantId)
}

export const findIntakeDuplicates = async (
  payload: Payload,
  input: Pick<NormalizedIntakeInput, "contentHash" | "normalizedUrl" | "tenantId" | "title">,
): Promise<IntakeRow[]> => {
  const matches = [
    ...(input.normalizedUrl === undefined
      ? []
      : [{ normalizedUrl: { equals: input.normalizedUrl } }]),
    { title: { equals: input.title } },
    ...(input.contentHash === undefined ? [] : [{ contentHash: { equals: input.contentHash } }]),
  ]
  const found = await payload.find({
    collection: "intake-items",
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: { and: [{ tenant: { equals: input.tenantId } }, { or: matches }] },
  })
  const expectedTitle = normalizedTitle(input.title)
  return (found.docs as unknown as IntakeRow[]).filter(
    (item) =>
      (input.normalizedUrl !== undefined && item.normalizedUrl === input.normalizedUrl) ||
      (input.contentHash !== undefined && item.contentHash === input.contentHash) ||
      (typeof item.title === "string" && normalizedTitle(item.title) === expectedTitle),
  )
}

export const createIntakeItem = async (
  payload: Payload,
  input: IntakeInput,
  user: unknown,
): Promise<{ readonly intakeItem: IntakeRow; readonly duplicates: readonly IntakeRow[] }> => {
  const normalized = normalizeIntakeInput(input)
  editableActorForTenant(user, normalized.tenantId)
  const duplicates = await findIntakeDuplicates(payload, normalized)
  const duplicateOf = duplicates[0]
  const created = await payload.create({
    collection: "intake-items",
    data: {
      channel: normalized.channel,
      ...(normalized.connectorId === undefined ? {} : { connector: normalized.connectorId }),
      ...(normalized.contentHash === undefined ? {} : { contentHash: normalized.contentHash }),
      ...(duplicateOf === undefined ? {} : { duplicateOf: duplicateOf.id }),
      duplicateStatus: duplicateOf === undefined ? "unique" : "duplicate",
      ...(normalized.normalizedUrl === undefined
        ? {}
        : { normalizedUrl: normalized.normalizedUrl }),
      ...(normalized.sourceUrl === undefined ? {} : { sourceUrl: normalized.sourceUrl }),
      ...(normalized.suggestedSiteId === undefined
        ? {}
        : { suggestedSite: normalized.suggestedSiteId }),
      ...(normalized.summary === undefined ? {} : { summary: normalized.summary }),
      status: duplicateOf === undefined ? "new" : "duplicate",
      tenant: normalized.tenantId,
      title: normalized.title,
    },
    depth: 0,
    draft: true,
    overrideAccess: true,
  })
  return { intakeItem: created as unknown as IntakeRow, duplicates }
}

export type IntakeFetchEnqueuer = (job: {
  readonly intakeItemId: IntakeId
  readonly tenantId: IntakeId
}) => Promise<string>

/**
 * Makes a URL or RSS item visible as fetching only after its worker task was
 * accepted. Duplicate and manual items deliberately never enter this queue.
 */
export const scheduleIntakeFetch = async (
  payload: Payload,
  intakeItemId: IntakeId,
  user: unknown,
  enqueue: IntakeFetchEnqueuer,
): Promise<IntakeRow> => {
  const item = await loadItem(payload, intakeItemId)
  assertItemTenant(user, item)
  const tenantId = referenceId(item.tenant)
  const channel = item.channel
  const status = item.status
  if (tenantId === null) throw fail("INTAKE_ITEM_TENANT_INVALID", String(item.id))
  if (channel !== "url" && channel !== "rss") throw fail("INTAKE_FETCH_CHANNEL_INVALID")
  if (status !== "new" && status !== "failed")
    throw fail("INTAKE_FETCH_STATE_INVALID", String(status))

  await enqueue({ intakeItemId: item.id, tenantId })
  return (await payload.update({
    collection: "intake-items",
    data: { failureCode: null, failureReason: null, status: "fetching" },
    depth: 0,
    draft: true,
    id: item.id,
    overrideAccess: true,
  })) as unknown as IntakeRow
}

export const markIntakeQueueUnavailable = async (
  payload: Payload,
  intakeItemId: IntakeId,
  user: unknown,
): Promise<IntakeRow> => {
  const item = await loadItem(payload, intakeItemId)
  assertItemTenant(user, item)
  return (await payload.update({
    collection: "intake-items",
    data: {
      failureCode: "INTAKE_QUEUE_UNAVAILABLE",
      failureReason:
        "The fetch task could not be queued. Retry this intake item when the worker is available.",
      status: "new",
    },
    depth: 0,
    draft: true,
    id: item.id,
    overrideAccess: true,
  })) as unknown as IntakeRow
}

export const ignoreIntakeItem = async (
  payload: Payload,
  intakeItemId: IntakeId,
  user: unknown,
): Promise<IntakeRow> => {
  const item = await loadItem(payload, intakeItemId)
  assertItemTenant(user, item)
  return (await payload.update({
    collection: "intake-items",
    data: { status: "ignored" },
    depth: 0,
    draft: true,
    id: intakeItemId,
    overrideAccess: true,
  })) as unknown as IntakeRow
}

export const mergeIntakeItems = async (
  payload: Payload,
  sourceIntakeItemId: IntakeId,
  targetIntakeItemId: IntakeId,
  user: unknown,
): Promise<IntakeRow> => {
  if (String(sourceIntakeItemId) === String(targetIntakeItemId))
    throw fail("INTAKE_MERGE_SELF_REFERENCE")
  const [source, target] = await Promise.all([
    loadItem(payload, sourceIntakeItemId),
    loadItem(payload, targetIntakeItemId),
  ])
  const sourceClaims = assertItemTenant(user, source)
  const targetTenantId = referenceId(target.tenant)
  if (
    targetTenantId === null ||
    (sourceClaims.role !== "super-admin" &&
      String(sourceClaims.tenantId) !== String(targetTenantId))
  ) {
    throw fail("INTAKE_TENANT_MISMATCH")
  }
  return (await payload.update({
    collection: "intake-items",
    data: {
      duplicateOf: target.id,
      duplicateStatus: "duplicate",
      mergedInto: target.id,
      status: "merged",
    },
    depth: 0,
    draft: true,
    id: source.id,
    overrideAccess: true,
  })) as unknown as IntakeRow
}

const articleSourcesRegistered = (payload: Payload): boolean => {
  const collections = (
    payload as unknown as { config?: { collections?: readonly { slug?: string }[] } }
  ).config?.collections
  return collections?.some((collection) => collection.slug === "article-sources") ?? false
}

export type AdoptionInput = {
  readonly intakeItemId: IntakeId
  readonly siteId?: IntakeId
  readonly user: unknown
}

export const adoptIntakeItem = async (
  payload: Payload,
  input: AdoptionInput,
): Promise<{
  readonly contentId: IntakeId
  readonly editionId: IntakeId
  readonly intakeItem: IntakeRow
  readonly sourceLinked: boolean
  readonly sourceLinkStatus: "created" | "unregistered"
}> => {
  const intakeItem = await loadItem(payload, input.intakeItemId)
  const claims = assertItemTenant(input.user, intakeItem)
  if (claims.role === "content-service") throw fail("INTAKE_EDITOR_REQUIRED")
  const tenantId = referenceId(intakeItem.tenant)
  const siteId = input.siteId ?? referenceId(intakeItem.suggestedSite)
  if (tenantId === null) throw fail("INTAKE_ITEM_TENANT_INVALID", String(intakeItem.id))
  if (siteId === null || siteId === undefined) throw fail("INTAKE_ADOPTION_SITE_REQUIRED")

  const content = await payload.create({
    collection: "contents",
    data: {
      createdBy: "human",
      intent: "intake",
      tenant: tenantId,
      topic: String(intakeItem.title),
    },
    depth: 0,
    overrideAccess: true,
  })
  const title = text(intakeItem.title) ?? "Untitled intake"
  const summary = text(intakeItem.summary) ?? title
  const sourceUrl = text(intakeItem.sourceUrl)
  const extractedBlocks = Array.isArray(intakeItem.contentBlocks)
    ? (intakeItem.contentBlocks as unknown[])
        .filter(
          (block): block is Record<string, unknown> =>
            typeof block === "object" &&
            block !== null &&
            typeof (block as Record<string, unknown>)["blockType"] === "string",
        )
        .slice(0, 200)
    : []
  const body: unknown =
    extractedBlocks.length > 0 ? [...extractedBlocks] : [{ blockType: "paragraph", text: summary }]
  const edition = await payload.create({
    collection: "content-editions",
    data: {
      angle: title,
      body: body as never,
      citations:
        sourceUrl === undefined ? [] : [{ id: `intake-${intakeItem.id}`, title, url: sourceUrl }],
      content: content.id,
      creationOrigin: "human",
      entities: [],
      primaryTopic: title,
      secondaryTopics: [],
      site: siteId,
      summary,
      tenant: tenantId,
      title,
    },
    depth: 0,
    draft: true,
    overrideAccess: true,
  })

  const registered = articleSourcesRegistered(payload)
  if (registered) {
    await payload.create({
      collection: "article-sources",
      data: { edition: edition.id, intakeItem: intakeItem.id, role: "primary", tenant: tenantId },
      depth: 0,
      overrideAccess: true,
    })
  }
  const updated = (await payload.update({
    collection: "intake-items",
    data: { adoptedEdition: edition.id, status: "adopted" },
    depth: 0,
    draft: true,
    id: intakeItem.id,
    overrideAccess: true,
  })) as unknown as IntakeRow
  return {
    contentId: content.id,
    editionId: edition.id,
    intakeItem: updated,
    sourceLinked: registered,
    sourceLinkStatus: registered ? "created" : "unregistered",
  }
}

export const isSameIntakeReference = sameReference
