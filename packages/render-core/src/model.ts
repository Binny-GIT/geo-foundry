import type {
  Author,
  Breadcrumb,
  Citation,
  ContentBlock,
  Entity,
  Hero,
  PageDocument,
  RelatedPage,
  StructuredData,
} from "@geo/schema"

export type RenderHead = Readonly<{
  readonly identity: PageDocument["identity"]
  readonly metadata: PageDocument["metadata"]
  readonly route: PageDocument["route"]
  readonly seo: PageDocument["seo"]
  readonly structuredData: readonly StructuredData[]
}>

export type RenderFigureImage = Readonly<{
  readonly alt: string
  readonly caption?: string
  readonly height?: number
  readonly kind: "figure-image"
  readonly src: string
  readonly width?: number
}>

export type RenderHero = Readonly<{
  readonly image?: RenderFigureImage
  readonly kind: "hero"
  readonly summary?: string
  readonly title: string
}>

export type RenderParagraphBlock = Readonly<{
  readonly id?: string
  readonly kind: "paragraph"
  readonly text: string
}>

export type RenderHeadingBlock = Readonly<{
  readonly id?: string
  readonly kind: "heading"
  readonly level: 2 | 3 | 4 | 5 | 6
  readonly text: string
}>

export type RenderImageBlock = RenderFigureImage & Readonly<{ readonly id?: string }>

export type RenderQuoteBlock = Readonly<{
  readonly attribution?: string
  readonly citeUrl?: string
  readonly id?: string
  readonly kind: "quote"
  readonly text: string
}>

export type RenderListBlock = Readonly<{
  readonly id?: string
  readonly items: readonly string[]
  readonly kind: "ordered-list" | "unordered-list"
}>

export type RenderTableBlock = Readonly<{
  readonly caption?: string
  readonly columns: readonly string[]
  readonly id?: string
  readonly kind: "table"
  readonly rows: readonly (readonly string[])[]
}>

export type RenderFaqBlock = Readonly<{
  readonly id?: string
  readonly items: readonly Readonly<{ readonly answer: string; readonly question: string }>[]
  readonly kind: "faq"
}>

export type RenderCalloutBlock = Readonly<{
  readonly id?: string
  readonly kind: "callout"
  readonly text: string
  readonly title?: string
  readonly tone: "info" | "success" | "warning" | "danger"
}>

export type RenderCodeBlock = Readonly<{
  readonly caption?: string
  readonly code: string
  readonly id?: string
  readonly kind: "code"
  readonly language: string
}>

export type RenderVideoBlock = Readonly<{
  readonly id?: string
  readonly kind: "video"
  readonly poster?: string
  readonly src: string
  readonly title: string
  readonly transcript?: string
}>

export type RenderEmbedBlock = Readonly<{
  readonly id?: string
  readonly kind: "embed"
  readonly provider: string
  readonly title: string
  readonly url: string
}>

export type RenderReferencesBlock = Readonly<{
  readonly id?: string
  readonly items: readonly Readonly<{ readonly citation: Citation; readonly label: string }>[]
  readonly kind: "references"
}>

export type RenderBlock =
  | RenderParagraphBlock
  | RenderHeadingBlock
  | RenderImageBlock
  | RenderQuoteBlock
  | RenderListBlock
  | RenderTableBlock
  | RenderFaqBlock
  | RenderCalloutBlock
  | RenderCodeBlock
  | RenderVideoBlock
  | RenderEmbedBlock
  | RenderReferencesBlock

export type RenderSlotName = "page-header" | "after-hero" | "before-body" | "after-body" | "footer"

export type RenderSlotPayload = Readonly<{
  readonly name: RenderSlotName
  readonly pageId: string
  readonly pageType: PageDocument["pageType"]
  readonly pathname: string
}>

export type RenderContent = Readonly<{
  readonly author?: Author
  readonly blocks: readonly RenderBlock[]
  readonly breadcrumbs: readonly Breadcrumb[]
  readonly citations: readonly Citation[]
  readonly entities: readonly Entity[]
  readonly hero?: RenderHero
  readonly relatedPages: readonly RelatedPage[]
  readonly slots: readonly RenderSlotPayload[]
}>

export type RenderListing = Readonly<{
  readonly items: readonly RelatedPage[]
  readonly pagination?: Readonly<{
    readonly nextPathname?: string
    readonly page: number
    readonly pageSize: number
    readonly previousPathname?: string
    readonly totalItems: number
    readonly totalPages: number
  }>
}>

export type RenderContentPage = Readonly<{
  readonly content: RenderContent
  readonly head: RenderHead
  readonly kind: "content"
}>

export type RenderArticlePage = RenderContentPage & Readonly<{ readonly pageType: "article" }>

export type RenderArticleListPage = RenderContentPage &
  Readonly<{ readonly listing: RenderListing; readonly pageType: "article-list" }>

export type RenderCategoryPage = RenderContentPage &
  Readonly<{ readonly listing: RenderListing; readonly pageType: "category" }>

export type RenderTagPage = RenderContentPage &
  Readonly<{ readonly listing: RenderListing; readonly pageType: "tag" }>

export type RenderNotFoundPage = RenderContentPage & Readonly<{ readonly pageType: "not-found" }>

export type RenderRedirectPage = Readonly<{
  readonly head: RenderHead
  readonly kind: "redirect"
  readonly pageType: "redirect"
  readonly statusCode: 301
  readonly targetUrl: string
}>

export type RenderPage =
  | RenderArticlePage
  | RenderArticleListPage
  | RenderCategoryPage
  | RenderTagPage
  | RenderNotFoundPage
  | RenderRedirectPage

export type SourceContentBlock = ContentBlock
export type SourceHero = Hero
