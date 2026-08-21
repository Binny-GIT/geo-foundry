import { z } from "zod"

import { IdentifierSchema, PathnameSchema } from "../../page-document/v1/primitives.js"
import {
  CanonicalTimestampSchema,
  RELEASE_SCHEMA_VERSION,
  ReleaseArtifactPathSchema,
  Sha256Schema,
} from "./primitives.js"

const HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const compareCanonicalText = (left: string, right: string): number => {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

const ActivePageTypeSchema = z.enum(["article", "article-list", "category", "tag"])

export const RoutingIdSchema = IdentifierSchema.brand("RoutingId")
export const RoutingHostSchema = z.string().regex(HOST_PATTERN).brand("RoutingHost")
export const RoutingManifestPointerSchema = z
  .strictObject({
    manifestSha256: Sha256Schema,
    routingId: RoutingIdSchema,
    updatedAt: CanonicalTimestampSchema,
  })
  .readonly()
export const RoutingManifestHostSchema = z
  .strictObject({
    canonical: z.boolean(),
    host: RoutingHostSchema,
    siteId: IdentifierSchema,
  })
  .readonly()

const RoutingManifestInputSchema = z
  .strictObject({
    hosts: z.array(RoutingManifestHostSchema).min(1).readonly(),
    schemaVersion: z.literal(RELEASE_SCHEMA_VERSION),
  })
  .superRefine((manifest, context) => {
    const hosts = new Set<string>()
    const canonicalBySite = new Set<string>()
    for (const [index, entry] of manifest.hosts.entries()) {
      if (hosts.has(entry.host)) {
        context.addIssue({
          code: "custom",
          message: "ROUTING_HOST_DUPLICATE",
          path: ["hosts", index, "host"],
        })
      }
      hosts.add(entry.host)
      if (entry.canonical) {
        if (canonicalBySite.has(entry.siteId)) {
          context.addIssue({
            code: "custom",
            message: "ROUTING_SITE_CANONICAL_DUPLICATE",
            path: ["hosts", index, "canonical"],
          })
        }
        canonicalBySite.add(entry.siteId)
      }
    }
    const siteIds = new Set(manifest.hosts.map((entry) => entry.siteId))
    for (const siteId of siteIds) {
      if (!canonicalBySite.has(siteId)) {
        context.addIssue({
          code: "custom",
          message: "ROUTING_SITE_CANONICAL_MISSING",
          path: ["hosts"],
        })
      }
    }
  })

export const RoutingManifestSchema = RoutingManifestInputSchema.transform((manifest) =>
  Object.freeze({
    hosts: Object.freeze([...manifest.hosts].sort((left, right) => compareCanonicalText(left.host, right.host))),
    schemaVersion: manifest.schemaVersion,
  }),
)

export const RouteStatusSchema = z.enum(["active", "redirect", "gone", "not-found"])

const RouteEntryBase = {
  pathname: PathnameSchema,
} as const

export const RouteIndexEntrySchema = z.discriminatedUnion("status", [
  z
    .strictObject({
      ...RouteEntryBase,
      objectKey: ReleaseArtifactPathSchema,
      pageType: ActivePageTypeSchema,
      status: z.literal("active"),
    })
    .readonly(),
  z
    .strictObject({
      ...RouteEntryBase,
      objectKey: ReleaseArtifactPathSchema,
      pageType: z.literal("redirect"),
      status: z.literal("redirect"),
    })
    .readonly(),
  z
    .strictObject({
      ...RouteEntryBase,
      status: z.literal("gone"),
    })
    .readonly(),
  z
    .strictObject({
      ...RouteEntryBase,
      objectKey: ReleaseArtifactPathSchema,
      pageType: z.literal("not-found"),
      status: z.literal("not-found"),
    })
    .readonly(),
])

const RouteIndexInputSchema = z
  .strictObject({
    canonicalDomain: RoutingHostSchema,
    routes: z.array(RouteIndexEntrySchema).min(1).readonly(),
    schemaVersion: z.literal(RELEASE_SCHEMA_VERSION),
    siteId: IdentifierSchema,
  })
  .superRefine((routeIndex, context) => {
    const pathnames = new Set<string>()
    let notFoundRoutes = 0
    for (const [index, route] of routeIndex.routes.entries()) {
      if (pathnames.has(route.pathname)) {
        context.addIssue({
          code: "custom",
          message: "ROUTE_PATH_DUPLICATE",
          path: ["routes", index, "pathname"],
        })
      }
      pathnames.add(route.pathname)
      if (route.status === "not-found") {
        notFoundRoutes += 1
      }
    }
    if (notFoundRoutes !== 1) {
      context.addIssue({ code: "custom", message: "ROUTE_NOT_FOUND_REQUIRED", path: ["routes"] })
    }
  })

export const RouteIndexSchema = RouteIndexInputSchema.transform((routeIndex) =>
  Object.freeze({
    canonicalDomain: routeIndex.canonicalDomain,
    routes: Object.freeze(
      [...routeIndex.routes].sort((left, right) => compareCanonicalText(left.pathname, right.pathname)),
    ),
    schemaVersion: routeIndex.schemaVersion,
    siteId: routeIndex.siteId,
  }),
)

export type RoutingId = z.infer<typeof RoutingIdSchema>
export type RoutingHost = z.infer<typeof RoutingHostSchema>
export type RoutingManifestPointer = z.infer<typeof RoutingManifestPointerSchema>
export type RoutingManifestHost = z.infer<typeof RoutingManifestHostSchema>
export type RoutingManifestInput = z.input<typeof RoutingManifestSchema>
export type RoutingManifest = z.infer<typeof RoutingManifestSchema>
export type RouteStatus = z.infer<typeof RouteStatusSchema>
export type RouteIndexEntry = z.infer<typeof RouteIndexEntrySchema>
export type RouteIndex = z.infer<typeof RouteIndexSchema>

export const ROUTING_POINTER_KEY = "routing/channels/current.json" as const

export const routingManifestKey = (routingId: RoutingId): string =>
  `routing/releases/${routingId}/domains.json`

export const canonicalizeRoutingManifest = (input: unknown): RoutingManifest =>
  RoutingManifestSchema.parse(input)

export const serializeRoutingManifest = (input: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(canonicalizeRoutingManifest(input)))

export const hashRoutingManifestBytes = async (
  body: Uint8Array,
): Promise<z.infer<typeof Sha256Schema>> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(body))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
  return Sha256Schema.parse(hex)
}

export const hashRoutingManifest = async (input: unknown): Promise<z.infer<typeof Sha256Schema>> =>
  hashRoutingManifestBytes(serializeRoutingManifest(input))

export const routingPointerOf = (input: {
  readonly manifestSha256: z.infer<typeof Sha256Schema>
  readonly routingId: RoutingId
  readonly updatedAt: z.infer<typeof CanonicalTimestampSchema>
}): RoutingManifestPointer => RoutingManifestPointerSchema.parse(input)

export const routeIndexOf = (input: unknown): RouteIndex => RouteIndexSchema.parse(input)

export const routingManifestOf = (input: unknown): RoutingManifest => RoutingManifestSchema.parse(input)

export const routingManifestSiteIdOfHost = (
  manifest: RoutingManifest,
  host: RoutingHost,
): RoutingManifestHost | null => manifest.hosts.find((entry) => entry.host === host) ?? null

export const routeObjectKey = (route: RouteIndexEntry): string | null =>
  "objectKey" in route ? route.objectKey : null
