import {
  NotFoundPageSchema,
  RedirectPageSchema,
  type NotFoundPage,
  type RedirectPage,
} from "@geo/schema"

import { baseOf, slugOf, type PageClock } from "./document-base.js"
import { verifySeoConsistency } from "../seo/metadata.js"
import { assertRedirectTarget } from "../seo/urls.js"
import { buildWebPageGraph } from "../structured-data/graph.js"
import type { CompileSite } from "./snapshot.js"

/**
 * Single-hop 301 redirect page. The canonical URL stays on the source
 * pathname (never the target) and the document carries no JSON-LD: there is
 * no visible content for a graph to describe.
 */
export const compileRedirectPage = async (input: {
  readonly clock: PageClock
  readonly fromPathname: string
  readonly site: CompileSite
  readonly targetUrl: string
}): Promise<RedirectPage> => {
  const slug = slugOf(input.fromPathname)
  const title = `Moved: ${input.fromPathname}`
  const targetUrl = assertRedirectTarget(input.site, input.fromPathname, input.targetUrl)
  return RedirectPageSchema.parse({
    ...baseOf(
      input.site,
      input.fromPathname,
      title,
      input.site.seoDefaults.description,
      `page-redirect-${slug}`,
      `redirect-${slug}`,
      input.clock,
      { openGraphType: "website", pageType: "redirect" },
    ),
    pageType: "redirect" as const,
    redirect: { statusCode: 301, targetUrl },
  })
}

/** Site-wide not-found page; never indexed. */
export const compileNotFoundPage = async (input: {
  readonly clock: PageClock
  readonly pathname: string
  readonly site: CompileSite
}): Promise<NotFoundPage> => {
  const breadcrumbs = [
    { pathname: "/", title: input.site.name },
    { pathname: input.pathname, title: "Page not found" },
  ]
  const base = baseOf(
    input.site,
    input.pathname,
    "Page not found",
    input.site.seoDefaults.description,
    "page-not-found",
    "not-found",
    input.clock,
    { openGraphType: "website", pageType: "not-found" },
  )
  const document = NotFoundPageSchema.parse({
    ...base,
    body: [{ text: "The requested page could not be found.", type: "paragraph" }],
    breadcrumbs,
    hero: { summary: input.site.seoDefaults.description, title: "Page not found" },
    pageType: "not-found" as const,
    structuredData: buildWebPageGraph({
      breadcrumbs,
      canonicalUrl: base.route.canonicalUrl,
      name: "Page not found",
    }),
  })
  verifySeoConsistency(document)
  return document
}
