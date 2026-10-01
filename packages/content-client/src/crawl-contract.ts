import { z } from "zod"

export const crawlJobIdSchema = z.string().regex(/^job_[0-9a-f]{16}$/)
export const crawlEntrySchema = z
  .object({
    content: z.string().min(1).max(200_000),
    sourceUrl: z.string().url().max(4_000),
    summary: z.string().max(20_000).nullable(),
    title: z.string().min(1).max(1_000),
  })
  .strict()

export const crawlDispatchInputSchema = z.object({
  connectorId: z.number().int().positive(),
  parentIntakeItemId: z.number().int().positive(),
  secretReference: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  sourceEndpoint: z.string().url(),
  tenantId: z.number().int().positive(),
})
export const crawlJobInputSchema = z.object({
  jobId: crawlJobIdSchema,
  parentIntakeItemId: z.number().int().positive(),
  secretReference: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  state: z.enum(["dispatched", "notified", "ingesting", "ingested", "failed"]),
  tenantId: z.number().int().positive(),
})
export const crawlCollectionSchema = z
  .object({
    schema_version: z.string().startsWith("1."),
    type: z.literal("article_collection"),
    source_url: z.string(),
    requested_count: z.number().int(),
    returned_count: z.number().int(),
    status: z.enum(["complete", "partial"]),
    items: z
      .array(
        z
          .object({
            url: z.string().url(),
            canonical_url: z.string().url().nullish(),
            title: z.string().nullish(),
            content: z.string(),
            summary: z.string().nullish(),
            _meta: z.unknown().optional(),
            meta: z.unknown().optional(),
          })
          .passthrough(),
      )
      .max(50),
    warnings: z
      .array(z.object({ code: z.string(), message: z.string(), url: z.string().nullish() }))
      .optional(),
    _meta: z.unknown().optional(),
    meta: z.unknown().optional(),
  })
  .passthrough()
export const crawlRemoteJobSchema = z
  .object({
    id: crawlJobIdSchema,
    status: z.enum(["pending", "leased", "running", "succeeded", "failed"]),
    result: crawlCollectionSchema.nullish(),
    error: z
      .union([
        z.string(),
        z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough(),
      ])
      .nullish(),
  })
  .passthrough()

export type CrawlEntry = z.infer<typeof crawlEntrySchema>
export type CrawlDispatchInput = z.infer<typeof crawlDispatchInputSchema>
export type CrawlJobInput = z.infer<typeof crawlJobInputSchema>
export type CrawlRemoteJob = z.infer<typeof crawlRemoteJobSchema>

export const crawlEntryOf = (
  article: z.infer<typeof crawlCollectionSchema>["items"][number],
): CrawlEntry => ({
  content: article.content,
  sourceUrl: article.canonical_url ?? article.url,
  summary: article.summary ?? null,
  title: article.title?.trim() || new URL(article.url).hostname,
})
