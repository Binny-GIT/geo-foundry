import { CompilerError, COMPILER_ERROR } from "../compile/errors.js"
import { canonicalUrlOf } from "../seo/urls.js"
import { requireUtcInstant } from "../compile/snapshot.js"

export type SitemapUrl = {
  readonly lastmod?: string
  readonly pathname: string
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "'": "&apos;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;",
}

/** XML 1.0 forbids most C0 control characters (tab/LF/CR excepted). */
const isForbiddenXmlChar = (char: string): boolean => {
  const code = char.charCodeAt(0)
  return code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)
}

const escapeXml = (value: string, field: string): string => {
  for (const char of value) {
    if (isForbiddenXmlChar(char)) {
      throw new CompilerError(
        COMPILER_ERROR.SITEMAP_XML_INVALID,
        `${field} contains control character U+${char.charCodeAt(0).toString(16).padStart(4, "0")} that cannot appear in XML 1.0`,
      )
    }
  }
  return value.replace(/[&<>'"]/g, (char) => XML_ESCAPES[char] ?? char)
}

/**
 * Sitemap XML from the active, indexable routes of one site. URLs derive
 * from the canonical domain (a foreign host would be a cross-site leak),
 * entries sort by pathname, and loc plus lastmod are XML-escaped with
 * control characters rejected outright.
 */
export const buildSitemapXml = (input: {
  readonly canonicalDomain: string
  readonly urls: readonly SitemapUrl[]
}): string => {
  const sorted = [...input.urls].sort((left, right) => left.pathname.localeCompare(right.pathname))
  const seen = new Set<string>()
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]
  for (const url of sorted) {
    if (seen.has(url.pathname)) {
      throw new CompilerError(
        COMPILER_ERROR.SITEMAP_XML_INVALID,
        `duplicate sitemap entry ${url.pathname}`,
      )
    }
    seen.add(url.pathname)
    const loc = canonicalUrlOf({ canonicalDomain: input.canonicalDomain }, url.pathname)
    let lastmodLine = ""
    if (url.lastmod !== undefined) {
      requireUtcInstant(url.lastmod, `sitemap lastmod of ${url.pathname}`)
      lastmodLine = `<lastmod>${escapeXml(url.lastmod, "lastmod")}</lastmod>`
    }
    lines.push(`<url><loc>${escapeXml(loc, "loc")}</loc>${lastmodLine}</url>`)
  }
  lines.push("</urlset>", "")
  return lines.join("\n")
}
