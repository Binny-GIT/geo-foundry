import { z } from "zod"

import {
  AssetUrlSchema,
  CitationIdSchema,
  ExtensionsSchema,
  HttpUrlSchema,
  IdentifierSchema,
  NonEmptyStringSchema,
} from "./primitives.js"

const BlockIdentityShape = {
  id: IdentifierSchema.optional(),
  extensions: ExtensionsSchema.optional(),
} as const

export const ParagraphBlockSchema = z
  .strictObject({
    type: z.literal("paragraph"),
    text: NonEmptyStringSchema,
    ...BlockIdentityShape,
  })
  .readonly()

export const HeadingBlockSchema = z
  .strictObject({
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    text: NonEmptyStringSchema,
    ...BlockIdentityShape,
  })
  .readonly()

export const ImageBlockSchema = z
  .strictObject({
    type: z.literal("image"),
    src: AssetUrlSchema,
    alt: NonEmptyStringSchema,
    caption: NonEmptyStringSchema.optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    ...BlockIdentityShape,
  })
  .readonly()

export const QuoteBlockSchema = z
  .strictObject({
    type: z.literal("quote"),
    text: NonEmptyStringSchema,
    attribution: NonEmptyStringSchema.optional(),
    citeUrl: HttpUrlSchema.optional(),
    ...BlockIdentityShape,
  })
  .readonly()

export const ListBlockSchema = z
  .strictObject({
    type: z.literal("list"),
    style: z.enum(["ordered", "unordered"]),
    items: z.array(NonEmptyStringSchema).min(1).readonly(),
    ...BlockIdentityShape,
  })
  .readonly()

export const TableBlockSchema = z
  .strictObject({
    type: z.literal("table"),
    columns: z.array(NonEmptyStringSchema).min(1).readonly(),
    rows: z.array(z.array(NonEmptyStringSchema).min(1).readonly()).min(1).readonly(),
    caption: NonEmptyStringSchema.optional(),
    ...BlockIdentityShape,
  })
  .readonly()

const FaqItemSchema = z
  .strictObject({
    question: NonEmptyStringSchema,
    answer: NonEmptyStringSchema,
  })
  .readonly()

export const FaqBlockSchema = z
  .strictObject({
    type: z.literal("faq"),
    items: z.array(FaqItemSchema).min(1).readonly(),
    ...BlockIdentityShape,
  })
  .readonly()

export const CalloutBlockSchema = z
  .strictObject({
    type: z.literal("callout"),
    tone: z.enum(["info", "success", "warning", "danger"]),
    title: NonEmptyStringSchema.optional(),
    text: NonEmptyStringSchema,
    ...BlockIdentityShape,
  })
  .readonly()

export const CodeBlockSchema = z
  .strictObject({
    type: z.literal("code"),
    language: NonEmptyStringSchema,
    code: z.string().min(1),
    caption: NonEmptyStringSchema.optional(),
    ...BlockIdentityShape,
  })
  .readonly()

export const VideoBlockSchema = z
  .strictObject({
    type: z.literal("video"),
    src: AssetUrlSchema,
    title: NonEmptyStringSchema,
    poster: AssetUrlSchema.optional(),
    transcript: NonEmptyStringSchema.optional(),
    ...BlockIdentityShape,
  })
  .readonly()

export const EmbedBlockSchema = z
  .strictObject({
    type: z.literal("embed"),
    provider: NonEmptyStringSchema,
    url: HttpUrlSchema,
    title: NonEmptyStringSchema,
    ...BlockIdentityShape,
  })
  .readonly()

const ReferenceItemSchema = z
  .strictObject({
    citationId: CitationIdSchema,
    label: NonEmptyStringSchema,
  })
  .readonly()

export const ReferencesBlockSchema = z
  .strictObject({
    type: z.literal("references"),
    items: z.array(ReferenceItemSchema).min(1).readonly(),
    ...BlockIdentityShape,
  })
  .readonly()

export const ContentBlockSchema = z.discriminatedUnion("type", [
  ParagraphBlockSchema,
  HeadingBlockSchema,
  ImageBlockSchema,
  QuoteBlockSchema,
  ListBlockSchema,
  TableBlockSchema,
  FaqBlockSchema,
  CalloutBlockSchema,
  CodeBlockSchema,
  VideoBlockSchema,
  EmbedBlockSchema,
  ReferencesBlockSchema,
])

export type ParagraphBlock = z.infer<typeof ParagraphBlockSchema>
export type HeadingBlock = z.infer<typeof HeadingBlockSchema>
export type ImageBlock = z.infer<typeof ImageBlockSchema>
export type QuoteBlock = z.infer<typeof QuoteBlockSchema>
export type ListBlock = z.infer<typeof ListBlockSchema>
export type TableBlock = z.infer<typeof TableBlockSchema>
export type FaqBlock = z.infer<typeof FaqBlockSchema>
export type CalloutBlock = z.infer<typeof CalloutBlockSchema>
export type CodeBlock = z.infer<typeof CodeBlockSchema>
export type VideoBlock = z.infer<typeof VideoBlockSchema>
export type EmbedBlock = z.infer<typeof EmbedBlockSchema>
export type ReferencesBlock = z.infer<typeof ReferencesBlockSchema>
export type ContentBlock = z.infer<typeof ContentBlockSchema>
