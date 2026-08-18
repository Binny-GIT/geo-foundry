import { z } from "zod"

import { ContentBlockSchema } from "./blocks.js"
import { ExtensionsSchema, HttpUrlSchema } from "./primitives.js"
import {
  AuthorSchema,
  BreadcrumbSchema,
  CitationSchema,
  EntitySchema,
  HeroSchema,
  IdentitySchema,
  MetadataSchema,
  PaginationSchema,
  RelatedPageSchema,
  RouteSchema,
  SeoSchema,
  StructuredDataSchema,
} from "./shared.js"

const DocumentBaseShape = {
  schemaVersion: z.literal(1),
  identity: IdentitySchema,
  route: RouteSchema,
  metadata: MetadataSchema,
  seo: SeoSchema,
  extensions: ExtensionsSchema.optional(),
} as const

const ContentPageShape = {
  ...DocumentBaseShape,
  hero: HeroSchema.optional(),
  author: AuthorSchema.optional(),
  citations: z.array(CitationSchema).readonly().optional(),
  entities: z.array(EntitySchema).readonly().optional(),
  relatedPages: z.array(RelatedPageSchema).readonly().optional(),
  breadcrumbs: z.array(BreadcrumbSchema).min(1).readonly(),
  structuredData: z.array(StructuredDataSchema).readonly().optional(),
  body: z.array(ContentBlockSchema).min(1).readonly(),
} as const

const ListingPageShape = {
  ...ContentPageShape,
  items: z.array(RelatedPageSchema).readonly(),
  pagination: PaginationSchema.optional(),
} as const

export const ArticlePageSchema = z
  .strictObject({ pageType: z.literal("article"), ...ContentPageShape })
  .readonly()

export const ArticleListPageSchema = z
  .strictObject({ pageType: z.literal("article-list"), ...ListingPageShape })
  .readonly()

export const CategoryPageSchema = z
  .strictObject({ pageType: z.literal("category"), ...ListingPageShape })
  .readonly()

export const TagPageSchema = z
  .strictObject({ pageType: z.literal("tag"), ...ListingPageShape })
  .readonly()

const RedirectSchema = z
  .strictObject({
    statusCode: z.literal(301),
    targetUrl: HttpUrlSchema,
  })
  .readonly()

export const RedirectPageSchema = z
  .strictObject({
    pageType: z.literal("redirect"),
    ...DocumentBaseShape,
    redirect: RedirectSchema,
  })
  .readonly()

export const NotFoundPageSchema = z
  .strictObject({ pageType: z.literal("not-found"), ...ContentPageShape })
  .readonly()

export const PageDocumentSchema = z
  .discriminatedUnion("pageType", [
    ArticlePageSchema,
    ArticleListPageSchema,
    CategoryPageSchema,
    TagPageSchema,
    RedirectPageSchema,
    NotFoundPageSchema,
  ])
  .meta({ id: "PageDocumentV1", title: "Geo Foundry PageDocument v1" })

export type ArticlePage = z.infer<typeof ArticlePageSchema>
export type ArticleListPage = z.infer<typeof ArticleListPageSchema>
export type CategoryPage = z.infer<typeof CategoryPageSchema>
export type TagPage = z.infer<typeof TagPageSchema>
export type RedirectPage = z.infer<typeof RedirectPageSchema>
export type NotFoundPage = z.infer<typeof NotFoundPageSchema>
export type PageDocument = z.infer<typeof PageDocumentSchema>
