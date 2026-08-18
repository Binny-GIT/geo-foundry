import { z } from "zod"

import {
  AssetUrlSchema,
  AuthorIdSchema,
  CitationIdSchema,
  ContentIdSchema,
  EditionIdSchema,
  EntityIdSchema,
  ExtensionsSchema,
  HttpUrlSchema,
  LocaleSchema,
  NonEmptyStringSchema,
  PageIdSchema,
  PathnameSchema,
  ReleaseIdSchema,
  SiteIdSchema,
  TimestampSchema,
} from "./primitives.js"

export const IdentitySchema = z
  .strictObject({
    pageId: PageIdSchema,
    siteId: SiteIdSchema,
    contentId: ContentIdSchema.optional(),
    editionId: EditionIdSchema.optional(),
    releaseId: ReleaseIdSchema.optional(),
  })
  .readonly()

export const RouteSchema = z
  .strictObject({
    locale: LocaleSchema,
    pathname: PathnameSchema,
    canonicalUrl: HttpUrlSchema,
  })
  .readonly()

export const MetadataSchema = z
  .strictObject({
    title: NonEmptyStringSchema.max(200),
    description: NonEmptyStringSchema.max(500),
    publishedAt: TimestampSchema.optional(),
    modifiedAt: TimestampSchema.optional(),
  })
  .readonly()

const RobotsSchema = z
  .strictObject({
    index: z.boolean(),
    follow: z.boolean(),
  })
  .readonly()

const OpenGraphSchema = z
  .strictObject({
    type: z.enum(["article", "website"]),
    title: NonEmptyStringSchema.max(200),
    description: NonEmptyStringSchema.max(500),
    image: AssetUrlSchema.optional(),
  })
  .readonly()

const TwitterSchema = z
  .strictObject({
    card: z.enum(["summary", "summary_large_image"]),
    title: NonEmptyStringSchema.max(200),
    description: NonEmptyStringSchema.max(500),
    image: AssetUrlSchema.optional(),
  })
  .readonly()

export const SeoSchema = z
  .strictObject({
    title: NonEmptyStringSchema.max(200),
    description: NonEmptyStringSchema.max(500),
    robots: RobotsSchema,
    openGraph: OpenGraphSchema.optional(),
    twitter: TwitterSchema.optional(),
  })
  .readonly()

const HeroImageSchema = z
  .strictObject({
    src: AssetUrlSchema,
    alt: NonEmptyStringSchema,
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .readonly()

export const HeroSchema = z
  .strictObject({
    title: NonEmptyStringSchema.max(200),
    summary: NonEmptyStringSchema.max(500).optional(),
    image: HeroImageSchema.optional(),
  })
  .readonly()

export const AuthorSchema = z
  .strictObject({
    id: AuthorIdSchema,
    name: NonEmptyStringSchema,
    url: HttpUrlSchema.optional(),
  })
  .readonly()

export const CitationSchema = z
  .strictObject({
    id: CitationIdSchema,
    title: NonEmptyStringSchema,
    url: HttpUrlSchema,
    publisher: NonEmptyStringSchema.optional(),
    publishedAt: TimestampSchema.optional(),
    accessedAt: TimestampSchema.optional(),
  })
  .readonly()

export const EntitySchema = z
  .strictObject({
    id: EntityIdSchema,
    type: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    url: HttpUrlSchema.optional(),
  })
  .readonly()

export const RelatedPageSchema = z
  .strictObject({
    pageId: PageIdSchema,
    title: NonEmptyStringSchema,
    pathname: PathnameSchema,
    description: NonEmptyStringSchema.max(500).optional(),
    image: AssetUrlSchema.optional(),
  })
  .readonly()

export const BreadcrumbSchema = z
  .strictObject({
    title: NonEmptyStringSchema,
    pathname: PathnameSchema,
  })
  .readonly()

export const PaginationSchema = z
  .strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
    previousPathname: PathnameSchema.optional(),
    nextPathname: PathnameSchema.optional(),
  })
  .readonly()

const StructuredAuthorSchema = z
  .strictObject({ name: NonEmptyStringSchema, url: HttpUrlSchema.optional() })
  .readonly()

const ArticleStructuredDataSchema = z
  .strictObject({
    type: z.literal("Article"),
    headline: NonEmptyStringSchema,
    url: HttpUrlSchema,
    description: NonEmptyStringSchema.optional(),
    image: AssetUrlSchema.optional(),
    datePublished: TimestampSchema.optional(),
    dateModified: TimestampSchema.optional(),
    author: StructuredAuthorSchema.optional(),
  })
  .readonly()

const CollectionStructuredDataSchema = z
  .strictObject({
    type: z.literal("CollectionPage"),
    name: NonEmptyStringSchema,
    url: HttpUrlSchema,
    description: NonEmptyStringSchema.optional(),
  })
  .readonly()

const WebPageStructuredDataSchema = z
  .strictObject({
    type: z.literal("WebPage"),
    name: NonEmptyStringSchema,
    url: HttpUrlSchema,
    description: NonEmptyStringSchema.optional(),
  })
  .readonly()

const BreadcrumbStructuredDataSchema = z
  .strictObject({
    type: z.literal("BreadcrumbList"),
    items: z.array(BreadcrumbSchema).min(1).readonly(),
  })
  .readonly()

const FaqStructuredDataSchema = z
  .strictObject({
    type: z.literal("FAQPage"),
    items: z
      .array(
        z.strictObject({ question: NonEmptyStringSchema, answer: NonEmptyStringSchema }).readonly(),
      )
      .min(1)
      .readonly(),
  })
  .readonly()

export const StructuredDataSchema = z.discriminatedUnion("type", [
  ArticleStructuredDataSchema,
  CollectionStructuredDataSchema,
  WebPageStructuredDataSchema,
  BreadcrumbStructuredDataSchema,
  FaqStructuredDataSchema,
])

export const ExtensionFieldShape = {
  extensions: ExtensionsSchema.optional(),
} as const

export type Identity = z.infer<typeof IdentitySchema>
export type Route = z.infer<typeof RouteSchema>
export type Metadata = z.infer<typeof MetadataSchema>
export type Seo = z.infer<typeof SeoSchema>
export type Hero = z.infer<typeof HeroSchema>
export type Author = z.infer<typeof AuthorSchema>
export type Citation = z.infer<typeof CitationSchema>
export type Entity = z.infer<typeof EntitySchema>
export type RelatedPage = z.infer<typeof RelatedPageSchema>
export type Breadcrumb = z.infer<typeof BreadcrumbSchema>
export type StructuredData = z.infer<typeof StructuredDataSchema>
