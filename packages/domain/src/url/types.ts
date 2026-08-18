import type { ContentId, UrlId } from "../ids.js"
import type { SiteOwnership } from "../ownership.js"
import type {
  CanonicalUrl,
  NormalizedLocale,
  NormalizedPathname,
  UrlUniqueKey,
} from "./normalization.js"

type UrlRouteBase = Readonly<{
  readonly contentId: ContentId
  readonly id: UrlId
  readonly key: UrlUniqueKey
  readonly locale: NormalizedLocale
  readonly ownership: SiteOwnership
  readonly pathname: NormalizedPathname
}>

export type ReservedUrlRoute = UrlRouteBase &
  Readonly<{
    readonly state: "reserved"
  }>

export type ActiveUrlRoute = UrlRouteBase &
  Readonly<{
    readonly canonicalUrl: CanonicalUrl
    readonly state: "active"
  }>

export type RedirectedUrlRoute = UrlRouteBase &
  Readonly<{
    readonly state: "redirected"
    readonly statusCode: 301
    readonly targetUrlId: UrlId
  }>

export type GoneUrlRoute = UrlRouteBase &
  Readonly<{
    readonly state: "gone"
  }>

export type UrlRoute = ActiveUrlRoute | GoneUrlRoute | RedirectedUrlRoute | ReservedUrlRoute

export type UrlRegistry = Readonly<{
  readonly reservedPathnames: readonly NormalizedPathname[]
  readonly revision: number
  readonly routes: readonly UrlRoute[]
}>

export type UrlRegistryChange<T> = Readonly<{
  readonly registry: UrlRegistry
  readonly value: T
}>
