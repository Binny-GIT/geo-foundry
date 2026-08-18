export const validArticleInput = {
  schemaVersion: 1,
  pageType: "article",
  identity: {
    pageId: "page-guide",
    siteId: "site-a",
    contentId: "content-guide",
    editionId: "edition-guide-en",
  },
  route: {
    locale: "en-US",
    pathname: "/guides/geo-foundry",
    canonicalUrl: "https://site-a.test/guides/geo-foundry",
  },
  metadata: {
    title: "Geo Foundry guide",
    description: "A canonical article fixture.",
    publishedAt: "2026-08-17T10:00:00.000Z",
    modifiedAt: "2026-08-17T11:00:00.000Z",
  },
  seo: {
    title: "Geo Foundry guide",
    description: "A canonical article fixture.",
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: "Geo Foundry guide",
      description: "A canonical article fixture.",
    },
  },
  hero: {
    title: "Geo Foundry guide",
    summary: "Build deterministic geographic content.",
  },
  author: {
    id: "author-mark",
    name: "Mark",
    url: "https://site-a.test/authors/mark",
  },
  citations: [
    {
      id: "citation-prd",
      title: "Geo Foundry product requirements",
      url: "https://site-a.test/sources/prd",
    },
  ],
  entities: [
    {
      id: "entity-geo-foundry",
      type: "SoftwareApplication",
      name: "Geo Foundry",
      url: "https://site-a.test/",
    },
  ],
  relatedPages: [
    {
      pageId: "page-category",
      title: "Guides",
      pathname: "/guides",
    },
  ],
  breadcrumbs: [
    { title: "Home", pathname: "/" },
    { title: "Guides", pathname: "/guides" },
  ],
  structuredData: [
    {
      type: "Article",
      headline: "Geo Foundry guide",
      url: "https://site-a.test/guides/geo-foundry",
      author: { name: "Mark", url: "https://site-a.test/authors/mark" },
    },
  ],
  body: [
    { type: "paragraph", text: "Geo Foundry produces portable page documents." },
    { type: "heading", level: 2, text: "Contract", id: "contract" },
  ],
  extensions: {
    "geo.example/editorial-score": 0.91,
  },
}

export const unsupportedVersionInputs = [
  { ...validArticleInput, schemaVersion: 0 },
  { ...validArticleInput, schemaVersion: 2 },
]

export const unknownRootInput = {
  ...validArticleInput,
  unexpected: true,
}

export const unknownBlockFieldInput = {
  ...validArticleInput,
  body: [{ type: "paragraph", text: "Strict block", unexpected: true }],
}

export const malformedHeadingInput = {
  ...validArticleInput,
  body: [{ type: "heading", level: 1, text: "Invalid level", id: "invalid" }],
}

export const invalidExtensionNamespaceInput = {
  ...validArticleInput,
  extensions: { editorialScore: 0.91 },
}
