import type { ContentId, UrlId } from "../ids.js"
import type { SiteOwnership } from "../ownership.js"
import type {
  ActiveUrlRoute,
  GoneUrlRoute,
  RedirectedUrlRoute,
  ReservedUrlRoute,
  UrlRegistry,
} from "./types.js"

export type ReserveUrlInput = Readonly<{
  readonly contentId: ContentId
  readonly expectedRevision: number
  readonly locale: unknown
  readonly ownership: SiteOwnership
  readonly pathname: unknown
  readonly urlId: UrlId
}>

export type PublishUrlInput = Readonly<{
  readonly expectedRevision: number
  readonly hostname: unknown
  readonly urlId: UrlId
}>

export type RetainActiveUrlInput = Readonly<{
  readonly urlId: UrlId
}>

export type RenameUrlInput = Readonly<{
  readonly expectedRevision: number
  readonly hostname: unknown
  readonly locale: unknown
  readonly pathname: unknown
  readonly sourceUrlId: UrlId
  readonly targetOwnership: SiteOwnership
  readonly targetUrlId: UrlId
}>

export type MarkUrlGoneInput = Readonly<{
  readonly expectedRevision: number
  readonly urlId: UrlId
}>

export type ReservedUrlChange = Readonly<{
  readonly registry: UrlRegistry
  readonly reserved: ReservedUrlRoute
}>

export type PublishedUrlChange = Readonly<{
  readonly active: ActiveUrlRoute
  readonly registry: UrlRegistry
}>

export type RenamedUrlChange = Readonly<{
  readonly active: ActiveUrlRoute
  readonly redirect: RedirectedUrlRoute
  readonly registry: UrlRegistry
}>

export type GoneUrlChange = Readonly<{
  readonly gone: GoneUrlRoute
  readonly registry: UrlRegistry
}>
