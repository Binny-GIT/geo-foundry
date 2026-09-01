/**
 * Refetches seeded real-article drafts with the structured extractor and
 * upgrades their body/summary in place. Only draft-status editions are
 * touched; published/approved evidence stays untouched. Run via:
 *   geo-foundry-cms-secure env PATH=... node --import tsx scripts/refresh-article-bodies.mjs [editionId...]
 */
import { getPayload } from "payload"

import { extractStructuredArticle } from "@geo/content-pipeline"
import config from "../src/payload.config.ts"

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const requested = process.argv.slice(2).map(Number).filter(Number.isInteger)

const payload = await getPayload({ config })
const results = []
try {
  const editor = (
    await payload.find({
      collection: "users",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { email: { equals: "embed-editor@geo-foundry.test" } },
    })
  ).docs[0]
  if (editor === undefined) throw new Error("EDITOR_MISSING")

  const editions = await payload.find({
    collection: "content-editions",
    depth: 1,
    draft: true,
    limit: 100,
    overrideAccess: true,
    sort: "-id",
    where: requested.length > 0 ? { id: { in: requested } } : { id: { gte: 567 } },
  })

  for (const edition of editions.docs) {
    if (edition.workflowStatus !== "draft") {
      results.push({ editionId: edition.id, skipped: edition.workflowStatus })
      continue
    }
    const sources = await payload.find({
      collection: "article-sources",
      depth: 1,
      limit: 1,
      overrideAccess: true,
      where: { edition: { equals: edition.id } },
    })
    const sourceUrl = sources.docs[0]?.intakeItem?.sourceUrl
    if (typeof sourceUrl !== "string" || sourceUrl.length === 0) {
      results.push({ editionId: edition.id, skipped: "no-source-url" })
      continue
    }
    try {
      const response = await fetch(sourceUrl, {
        headers: { "user-agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      const html = await response.text()
      const page = extractStructuredArticle(html, response.url || sourceUrl)
      if (page.blocks.length === 0) throw new Error("NO_BLOCKS")
      await payload.update({
        collection: "content-editions",
        data: {
          body: page.blocks.slice(0, 200),
          summary: page.summary.slice(0, 500),
        },
        depth: 0,
        draft: true,
        id: edition.id,
        overrideAccess: true,
        user: editor,
      })
      const images = page.blocks.filter((b) => b.blockType === "image").length
      results.push({
        blocks: page.blocks.length,
        editionId: edition.id,
        images,
        title: String(edition.title).slice(0, 50),
      })
      console.log(JSON.stringify({ code: "REFRESHED", editionId: edition.id, blocks: page.blocks.length, images }))
    } catch (error) {
      results.push({ editionId: edition.id, error: String(error).slice(0, 100) })
      console.log(JSON.stringify({ code: "REFRESH_FAILED", editionId: edition.id, error: String(error).slice(0, 100) }))
    }
  }

  console.log("REFRESH_SUMMARY_BEGIN")
  console.log(JSON.stringify(results, null, 1))
  console.log("REFRESH_SUMMARY_END")
} finally {
  void payload.destroy()
}
