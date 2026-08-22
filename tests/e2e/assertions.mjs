const fail = (code) => {
  throw new Error(code)
}

export const assertNoBrandLeak = (html, forbiddenBrand) => {
  if (html.includes(forbiddenBrand)) {
    fail("E2E_BRAND_LEAK_DETECTED")
  }
}

export const assertServerRenderedBody = (html, expectedText) => {
  if (!html.includes(expectedText)) {
    fail("E2E_CLIENT_ONLY_BODY_DETECTED")
  }
}

export const assertCanonicalDomain = (canonicalUrl, hostname) => {
  let parsed
  try {
    parsed = new URL(canonicalUrl)
  } catch {
    fail("E2E_CANONICAL_INVALID")
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== hostname) {
    fail("E2E_WRONG_DOMAIN_CANONICAL_DETECTED")
  }
}

export const assertSitemapScope = (xml, input) => {
  const urls = new Set(Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]))
  for (const forbidden of input.forbidden) {
    if (urls.has(forbidden)) {
      fail("E2E_DRAFT_OR_FOREIGN_SITEMAP_ENTRY_DETECTED")
    }
  }
  for (const url of urls) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      fail("E2E_SITEMAP_INVALID_URL")
    }
    if (input.forbiddenHosts.includes(parsed.hostname)) {
      fail("E2E_DRAFT_OR_FOREIGN_SITEMAP_ENTRY_DETECTED")
    }
  }
  for (const required of input.required) {
    if (!urls.has(required)) {
      fail("E2E_SITEMAP_REQUIRED_ENTRY_MISSING")
    }
  }
}

export const parseJsonLd = (scripts) => {
  const nodes = []
  for (const script of scripts) {
    let parsed
    try {
      parsed = JSON.parse(script)
    } catch {
      fail("E2E_JSON_LD_INVALID")
    }
    const graph = Array.isArray(parsed) ? parsed : (parsed["@graph"] ?? [parsed])
    if (!Array.isArray(graph)) {
      fail("E2E_JSON_LD_INVALID")
    }
    nodes.push(...graph)
  }
  if (nodes.length === 0) {
    fail("E2E_JSON_LD_MISSING")
  }
  const ids = new Set()
  for (const node of nodes) {
    if (
      node === null ||
      typeof node !== "object" ||
      (typeof node.type !== "string" && typeof node["@type"] !== "string")
    ) {
      fail("E2E_JSON_LD_INVALID")
    }
    const id = typeof node.id === "string" ? node.id : node["@id"]
    if (typeof id === "string") {
      if (ids.has(id)) {
        fail("E2E_JSON_LD_DUPLICATE_ID")
      }
      ids.add(id)
    }
  }
  return nodes
}

export const assertArticleJsonLd = (nodes, input) => {
  const typeOf = (node) => node.type ?? node["@type"]
  const article = nodes.find((node) => typeOf(node) === "Article" || typeOf(node) === "NewsArticle")
  const organization = nodes.find((node) => typeOf(node) === "Organization")
  const breadcrumbs = nodes.find((node) => typeOf(node) === "BreadcrumbList")
  if (article === undefined || organization === undefined || breadcrumbs === undefined) {
    fail("E2E_JSON_LD_REQUIRED_NODE_MISSING")
  }
  if (article.headline !== input.title || article.url !== input.canonicalUrl) {
    fail("E2E_JSON_LD_ARTICLE_MISMATCH")
  }
  assertCanonicalDomain(article.url, input.hostname)
}

export const assertStablePath = (before, after) => {
  if (before.pathname !== after.pathname || before.releaseId === after.releaseId) {
    fail("E2E_ACTIVE_URL_MUTATION_DETECTED")
  }
}

export const assertRendererVersions = (siteA, siteB) => {
  for (const dependency of ["@geo/render-core", "@geo/render-react", "@geo/runtime"]) {
    if (siteA.dependencies?.[dependency] !== siteB.dependencies?.[dependency]) {
      fail("E2E_RENDERER_VERSION_MISMATCH_DETECTED")
    }
  }
}
