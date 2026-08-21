import type { ReactNode } from "react"

import type { RenderHead } from "@geo/render-core"

const scriptSafeJson = (value: unknown): string =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")

const schemaJsonLd = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(schemaJsonLd)
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key === "id" ? "@id" : key === "type" ? "@type" : key,
        schemaJsonLd(nestedValue),
      ]),
    )
  }
  return value
}

export const serializeGeoJsonLd = (structuredData: RenderHead["structuredData"]): string =>
  scriptSafeJson({ "@context": "https://schema.org", "@graph": schemaJsonLd(structuredData) })

export type GeoHeadProps = Readonly<{ readonly head: RenderHead }>

export const GeoHead = ({ head }: GeoHeadProps): ReactNode => {
  const { metadata, route, seo, structuredData } = head
  const robots = `${seo.robots.index ? "index" : "noindex"},${seo.robots.follow ? "follow" : "nofollow"}`
  return (
    <>
      <title>{seo.title}</title>
      <meta content={seo.description} name="description" />
      <meta content={robots} name="robots" />
      <link href={route.canonicalUrl} rel="canonical" />
      <meta content={seo.openGraph?.type ?? "website"} property="og:type" />
      <meta content={seo.openGraph?.title ?? seo.title} property="og:title" />
      <meta content={seo.openGraph?.description ?? seo.description} property="og:description" />
      <meta content={route.canonicalUrl} property="og:url" />
      {seo.openGraph?.image === undefined ? null : (
        <meta content={seo.openGraph.image} property="og:image" />
      )}
      {seo.twitter === undefined ? null : <meta content={seo.twitter.card} name="twitter:card" />}
      {seo.twitter === undefined ? null : <meta content={seo.twitter.title} name="twitter:title" />}
      {seo.twitter === undefined ? null : (
        <meta content={seo.twitter.description} name="twitter:description" />
      )}
      {seo.twitter?.image === undefined ? null : (
        <meta content={seo.twitter.image} name="twitter:image" />
      )}
      {metadata.publishedAt === undefined ? null : (
        <meta content={metadata.publishedAt} property="article:published_time" />
      )}
      {metadata.modifiedAt === undefined ? null : (
        <meta content={metadata.modifiedAt} property="article:modified_time" />
      )}
      {structuredData.length === 0 ? null : (
        <script
          dangerouslySetInnerHTML={{ __html: serializeGeoJsonLd(structuredData) }}
          type="application/ld+json"
        />
      )}
    </>
  )
}
