/*
 * JSON 出口要求"图片绝对地址"：PageDocument 里站内媒体引用固定是编译器
 * 写入的 `/media/<filename>`（0b 批次约定），对站点自己的渲染管线够用，
 * 但对经交付服务转发出去的 JSON/HTML 消费方（NKMed 等）没有意义——它们
 * 不认识这个相对路径应该去哪台主机取。这里把它改写成指向本交付服务
 * `/v1/sites/{host}/media/{filename}` 的绝对 URL；外部 https 链接原样保留。
 *
 * 覆盖 PageDocument 里所有 AssetUrlSchema 类型的字段：hero 图、SEO 的
 * openGraph/twitter 图、正文 image/video 块、relatedPages/listing items 的
 * 缩略图、structuredData 里 Article/NewsArticle.image、Organization.logo、
 * ImageObject.url。structuredData 里的 `url` 字段（Article.url、
 * Organization.url 等页面自身地址）本来就是 HttpUrlSchema（强制绝对），
 * 不在改写范围内。
 */
import type {
  ContentBlock,
  Hero,
  PageDocument,
  RelatedPage,
  Seo,
  StructuredData,
} from "@geo/schema"

const MEDIA_PATHNAME_PATTERN = /^\/media\/([^/]+)$/

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value)

export const absoluteAssetUrlOf = (value: string, mediaBaseUrl: string): string => {
  if (isAbsoluteUrl(value)) return value
  const match = MEDIA_PATHNAME_PATTERN.exec(value)
  const filename = match?.[1]
  if (filename === undefined) return value
  return `${mediaBaseUrl}/${encodeURIComponent(filename)}`
}

const rewriteHero = (hero: Hero, mediaBaseUrl: string): Hero =>
  hero.image === undefined
    ? hero
    : { ...hero, image: { ...hero.image, src: absoluteAssetUrlOf(hero.image.src, mediaBaseUrl) } }

const rewriteSeo = (seo: Seo, mediaBaseUrl: string): Seo => ({
  ...seo,
  ...(seo.openGraph === undefined
    ? {}
    : {
        openGraph: {
          ...seo.openGraph,
          ...(seo.openGraph.image === undefined
            ? {}
            : { image: absoluteAssetUrlOf(seo.openGraph.image, mediaBaseUrl) }),
        },
      }),
  ...(seo.twitter === undefined
    ? {}
    : {
        twitter: {
          ...seo.twitter,
          ...(seo.twitter.image === undefined
            ? {}
            : { image: absoluteAssetUrlOf(seo.twitter.image, mediaBaseUrl) }),
        },
      }),
})

const rewriteRelatedPage = (page: RelatedPage, mediaBaseUrl: string): RelatedPage => ({
  ...page,
  ...(page.image === undefined ? {} : { image: absoluteAssetUrlOf(page.image, mediaBaseUrl) }),
})

const rewriteBlock = (block: ContentBlock, mediaBaseUrl: string): ContentBlock => {
  switch (block.type) {
    case "image":
      return { ...block, src: absoluteAssetUrlOf(block.src, mediaBaseUrl) }
    case "video":
      return {
        ...block,
        src: absoluteAssetUrlOf(block.src, mediaBaseUrl),
        ...(block.poster === undefined
          ? {}
          : { poster: absoluteAssetUrlOf(block.poster, mediaBaseUrl) }),
      }
    default:
      return block
  }
}

const rewriteStructuredDataItem = (item: StructuredData, mediaBaseUrl: string): StructuredData => {
  switch (item.type) {
    case "Article":
    case "NewsArticle":
      return item.image === undefined
        ? item
        : { ...item, image: absoluteAssetUrlOf(item.image, mediaBaseUrl) }
    case "Organization":
      return item.logo === undefined
        ? item
        : { ...item, logo: absoluteAssetUrlOf(item.logo, mediaBaseUrl) }
    case "ImageObject":
      return { ...item, url: absoluteAssetUrlOf(item.url, mediaBaseUrl) }
    default:
      return item
  }
}

/*
 * 各字段单独作为参数传入，而不是打包成一个对象类型——PageDocument 的
 * hero/relatedPages/structuredData 在具体分支类型（ArticlePage 等）里是
 * "可选 key"，读出来的值类型是 `T | undefined`；但在
 * exactOptionalPropertyTypes 下，"可选 key"与"必有 key、值为 T | undefined"
 * 是两种不同的结构化契约，互相判定为不可赋值。函数参数按值传递就没有这个
 * 顾虑：`document.hero` 读出来的静态类型始终是 `Hero | undefined`，直接
 * 传给一个同类型的形参不受这条限制影响。
 */
const rewriteSharedContentFields = (
  body: readonly ContentBlock[],
  hero: Hero | undefined,
  relatedPages: readonly RelatedPage[] | undefined,
  seo: Seo,
  structuredData: readonly StructuredData[] | undefined,
  mediaBaseUrl: string,
) => ({
  body: body.map((block) => rewriteBlock(block, mediaBaseUrl)),
  seo: rewriteSeo(seo, mediaBaseUrl),
  ...(hero === undefined ? {} : { hero: rewriteHero(hero, mediaBaseUrl) }),
  ...(relatedPages === undefined
    ? {}
    : { relatedPages: relatedPages.map((page) => rewriteRelatedPage(page, mediaBaseUrl)) }),
  ...(structuredData === undefined
    ? {}
    : {
        structuredData: structuredData.map((item) => rewriteStructuredDataItem(item, mediaBaseUrl)),
      }),
})

/** 把 PageDocument 里所有站内媒体引用改写为指向本交付服务的绝对 URL。 */
export const absolutizePageDocumentMedia = (
  document: PageDocument,
  mediaBaseUrl: string,
): PageDocument => {
  switch (document.pageType) {
    case "article":
    case "not-found":
      return {
        ...document,
        ...rewriteSharedContentFields(
          document.body,
          document.hero,
          document.relatedPages,
          document.seo,
          document.structuredData,
          mediaBaseUrl,
        ),
      }
    case "article-list":
    case "category":
    case "tag":
      return {
        ...document,
        ...rewriteSharedContentFields(
          document.body,
          document.hero,
          document.relatedPages,
          document.seo,
          document.structuredData,
          mediaBaseUrl,
        ),
        items: document.items.map((item) => rewriteRelatedPage(item, mediaBaseUrl)),
      }
    case "redirect":
      return { ...document, seo: rewriteSeo(document.seo, mediaBaseUrl) }
    default:
      return document
  }
}
