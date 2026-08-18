import { z } from "zod"

export const EXTENSION_KEY_PATTERN = "^[a-z0-9]+(?:[.-][a-z0-9]+)+/[a-z0-9-]+$" as const
const HTTP_URL_PATTERN = "^[Hh][Tt][Tt][Pp][Ss]?://" as const

export const NonEmptyStringSchema = z.string().trim().min(1)
export const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
export const LocaleSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)
export const PathnameSchema = z.string().regex(/^\/(?:[^?#]*)$/)
export const HttpUrlSchema = z.httpUrl().meta({ pattern: HTTP_URL_PATTERN })
export const AssetUrlSchema = z.union([HttpUrlSchema, PathnameSchema])
export const TimestampSchema = z.iso.datetime({ offset: true })
export const ExtensionKeySchema = z.string().regex(new RegExp(EXTENSION_KEY_PATTERN))
export const ExtensionsSchema = z.record(ExtensionKeySchema, z.json()).readonly()

export const PageIdSchema = IdentifierSchema.brand("PageId")
export const SiteIdSchema = IdentifierSchema.brand("SiteId")
export const ContentIdSchema = IdentifierSchema.brand("ContentId")
export const EditionIdSchema = IdentifierSchema.brand("EditionId")
export const ReleaseIdSchema = IdentifierSchema.brand("ReleaseId")
export const AuthorIdSchema = IdentifierSchema.brand("AuthorId")
export const CitationIdSchema = IdentifierSchema.brand("CitationId")
export const EntityIdSchema = IdentifierSchema.brand("EntityId")

export type PageId = z.infer<typeof PageIdSchema>
export type SiteId = z.infer<typeof SiteIdSchema>
export type ContentId = z.infer<typeof ContentIdSchema>
export type EditionId = z.infer<typeof EditionIdSchema>
export type ReleaseId = z.infer<typeof ReleaseIdSchema>
export type AuthorId = z.infer<typeof AuthorIdSchema>
export type CitationId = z.infer<typeof CitationIdSchema>
export type EntityId = z.infer<typeof EntityIdSchema>
export type Extensions = z.infer<typeof ExtensionsSchema>
