/**
 * Seeds the embed tenant with REAL public articles through the REAL intake
 * pipeline: URL import -> Worker fetch -> adopt -> (subset) review workflow
 * -> one scheduled publish. Run on mk-dev via the secure wrapper:
 *   geo-foundry-cms-secure env PATH=... node --import tsx scripts/seed-real-articles.mjs
 */
import { getPayload } from "payload"

import config from "../src/payload.config.ts"
import { createPublicationPlan } from "../src/services/publication-plans.ts"
import {
  adoptIntakeItem,
  createIntakeItem,
  scheduleIntakeFetch,
} from "../src/services/intake.ts"
import { enqueueIntakeFetchFromEnvironment } from "../src/services/intake-queue.ts"
import {
  currentEditionInputHash,
  loadWorkflowEdition,
  recordAssessment,
  transitionEdition,
} from "../src/services/edition-workflow.ts"

const PER_SOURCE = 4
const GLOBAL_CAP = 26
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

const SOURCES = [
  {
    name: "cloudflare",
    index: "https://blog.cloudflare.com/",
    pattern: /href="\/([a-z0-9][a-z0-9-]{9,})\/"/g,
    base: "https://blog.cloudflare.com/",
    block: ["zh-cn", "authors", "author", "tag", "tags", "category", "categories", "products", "pages", "about", "learning", "cloudflare-one"],
  },
  {
    name: "ruanyifeng",
    index: "https://www.ruanyifeng.com/blog/",
    pattern: /href="(\/blog\/20\d\d\/[^"]{6,})"/g,
    base: "https://www.ruanyifeng.com",
    block: [],
  },
  {
    name: "go",
    index: "https://go.dev/blog/",
    pattern: /href="\/blog\/([a-z0-9-]{4,})"/g,
    base: "https://go.dev",
    block: [],
  },
  {
    name: "rust",
    index: "https://blog.rust-lang.org/",
    pattern: /href="(https:\/\/blog\.rust-lang\.org\/20\d\d\/\d\d\/\d\d\/[a-zA-Z0-9.-]+\/?)"/g,
    base: "https://blog.rust-lang.org",
    block: [],
  },
  {
    name: "nodejs",
    index: "https://nodejs.org/en/blog",
    pattern: /href="(\/en\/blog\/[a-z0-9-]{4,}\/?)"/g,
    base: "https://nodejs.org",
    block: [],
  },
  {
    name: "meituan",
    index: "https://tech.meituan.com/",
    pattern: /href="(\/20\d\d\/\d\d\/[a-z0-9-]+\.html)"/g,
    base: "https://tech.meituan.com",
    block: [],
  },
  {
    name: "webdev",
    index: "https://web.dev/blog",
    pattern: /href="(\/blog\/[a-z0-9-]{6,}\/?)"/g,
    base: "https://web.dev",
    block: [],
  },
]

const FIXED_URLS = [
  "https://developer.mozilla.org/zh-CN/docs/Web/CSS/flexbox",
  "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers",
  "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array",
  "https://www.python.org/dev/peps/pep-0020/",
]

const fetchHtml = async (url, timeoutMs = 15_000) => {
  const response = await fetch(url, {
    headers: { "user-agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  })
  const type = response.headers.get("content-type") ?? ""
  const body = response.ok && type.includes("html") ? await response.text() : ""
  return { ok: response.ok, status: response.status, type, body }
}

const harvest = async () => {
  const picked = []
  const seen = new Set()
  for (const source of SOURCES) {
    let page
    try {
      page = await fetchHtml(source.index)
    } catch {
      page = { ok: false, body: "" }
    }
    if (!page.ok || page.body.length === 0) {
      console.log(JSON.stringify({ code: "SEED_SOURCE_INDEX_FAILED", source: source.name, status: page.status }))
      continue
    }
    const links = [...page.body.matchAll(source.pattern)]
      .map((match) => new URL(match[1], source.base).href)
      .filter((href) => !source.block.some((word) => href.includes(`/${word}`)))
      .filter((href) => !seen.has(href))
    let taken = 0
    for (const href of links) {
      if (taken >= PER_SOURCE || picked.length >= GLOBAL_CAP - FIXED_URLS.length) break
      seen.add(href)
      let check
      try {
        check = await fetchHtml(href, 12_000)
      } catch {
        continue
      }
      if (check.ok && check.body.length > 3000) {
        picked.push({ href, source: source.name })
        taken += 1
      }
    }
    console.log(JSON.stringify({ code: "SEED_SOURCE_HARVESTED", source: source.name, taken }))
  }
  for (const href of FIXED_URLS) {
    if (picked.length >= GLOBAL_CAP) break
    if (seen.has(href)) continue
    seen.add(href)
    picked.push({ href, source: "fixed" })
  }
  return picked
}

const titleOf = (href) => {
  const path = new URL(href).pathname
  const slug = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "")
    .replace(/\.(html|php)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
  return (slug.length > 0 ? slug : new URL(href).hostname).slice(0, 90)
}

const payload = await getPayload({ config })
const summary = { adopted: [], fetched: [], harvest: 0, published: null, reviewed: [] }
try {
  const findUser = async (email) => {
    const found = await payload.find({
      collection: "users",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { email: { equals: email } },
    })
    return found.docs[0]
  }
  const editor = await findUser("embed-editor@geo-foundry.test")
  const tenantAdmin = await findUser("embed-tenant-admin@geo-foundry.test")
  const tenantId = editor.tenant
  const ensureRoleUser = async (email, role) => {
    const existing = await findUser(email)
    if (existing !== undefined) return existing
    return payload.create({
      collection: "users",
      data: { email, password: `seed-${role}-${Date.now()}`, role, tenant: tenantId },
      depth: 0,
      overrideAccess: false,
      user: tenantAdmin,
    })
  }
  const reviewer = await ensureRoleUser("e2e-scheduled-reviewer@geo-foundry.test", "reviewer")
  const publisher = await ensureRoleUser("e2e-scheduled-publisher@geo-foundry.test", "publisher")

  const sites = await payload.find({
    collection: "sites",
    depth: 0,
    limit: 5,
    overrideAccess: true,
    sort: "id",
    where: { and: [{ tenant: { equals: tenantId } }, { status: { equals: "active" } }] },
  })
  const siteIds = sites.docs.map((site) => site.id)

  const articles = await harvest()
  summary.harvest = articles.length
  console.log(JSON.stringify({ code: "SEED_HARVEST_DONE", count: articles.length }))

  const queued = []
  for (const [index, article] of articles.entries()) {
    try {
      const result = await createIntakeItem(
        payload,
        {
          channel: "url",
          suggestedSiteId: siteIds[index % siteIds.length],
          sourceUrl: article.href,
          tenantId,
          title: titleOf(article.href),
        },
        editor,
      )
      if (result.duplicates.length > 0) {
        console.log(JSON.stringify({ code: "SEED_DUPLICATE_SKIPPED", href: article.href }))
        continue
      }
      await scheduleIntakeFetch(payload, result.intakeItem.id, editor, enqueueIntakeFetchFromEnvironment)
      queued.push({ href: article.href, id: result.intakeItem.id, source: article.source })
      console.log(JSON.stringify({ code: "SEED_QUEUED", id: result.intakeItem.id, source: article.source, href: article.href }))
    } catch (error) {
      console.log(JSON.stringify({ code: "SEED_QUEUE_FAILED", href: article.href, error: String(error).slice(0, 120) }))
    }
  }

  const deadline = Date.now() + 5 * 60_000
  const terminal = new Map()
  while (Date.now() < deadline && terminal.size < queued.length) {
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    for (const item of queued) {
      if (terminal.has(item.id)) continue
      const found = await payload.findByID({
        collection: "intake-items",
        depth: 0,
        id: item.id,
        overrideAccess: true,
      })
      if (found.status === "ready" || found.status === "failed") {
        terminal.set(item.id, found)
      }
    }
  }

  for (const item of queued) {
    const doc = terminal.get(item.id)
    if (doc === undefined) {
      summary.fetched.push({ href: item.href, status: "timeout" })
      continue
    }
    summary.fetched.push({
      href: item.href,
      realTitle: doc.title,
      status: doc.status,
      ...(doc.failureCode === undefined || doc.failureCode === null ? {} : { failure: doc.failureCode }),
    })
    if (doc.status !== "ready") continue
    try {
      const adopted = await adoptIntakeItem(payload, { intakeItemId: item.id, user: editor })
      const edition = await payload.findByID({
        collection: "content-editions",
        depth: 0,
        draft: true,
        id: adopted.editionId,
        overrideAccess: true,
      })
      const blocks = Array.isArray(edition.body) ? edition.body.length : 0
      summary.adopted.push({
        blocks,
        editionId: adopted.editionId,
        href: item.href,
        siteId: edition.site,
        title: doc.title,
      })
      console.log(JSON.stringify({ code: "SEED_ADOPTED", editionId: adopted.editionId, blocks, title: String(doc.title).slice(0, 60) }))
    } catch (error) {
      console.log(JSON.stringify({ code: "SEED_ADOPT_FAILED", id: item.id, error: String(error).slice(0, 120) }))
    }
  }

  const candidates = summary.adopted.filter((item) => item.blocks >= 1).slice(0, 3)
  for (const candidate of candidates) {
    try {
      await transitionEdition(payload, { editionId: candidate.editionId, target: "generating", user: editor })
      await transitionEdition(payload, { editionId: candidate.editionId, target: "review", user: editor })
      const draft = await loadWorkflowEdition(payload, candidate.editionId, {}, true)
      await recordAssessment(payload, {
        editionId: candidate.editionId,
        inputHash: currentEditionInputHash(draft),
        issues: [],
        modelId: "real-article-seed",
        promptVersion: "2026-09-01",
        provider: "deterministic",
        state: "passed",
        thresholdsHash: "c".repeat(64),
      })
      await transitionEdition(payload, { editionId: candidate.editionId, target: "approved", user: reviewer })
      summary.reviewed.push(candidate.editionId)
      console.log(JSON.stringify({ code: "SEED_REVIEWED", editionId: candidate.editionId }))
    } catch (error) {
      console.log(JSON.stringify({ code: "SEED_REVIEW_FAILED", editionId: candidate.editionId, error: String(error).slice(0, 140) }))
    }
  }

  const publishCandidate = await (async () => {
    for (const editionId of summary.reviewed) {
      const edition = await payload.findByID({
        collection: "content-editions",
        depth: 0,
        draft: true,
        id: editionId,
        overrideAccess: true,
      })
      const domain = await payload.find({
        collection: "domains",
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: {
          and: [
            { site: { equals: edition.site } },
            { role: { equals: "canonical" } },
            { status: { equals: "active" } },
          ],
        },
      })
      if (domain.docs[0] !== undefined) {
        return { edition, site: await payload.findByID({ collection: "sites", depth: 0, id: edition.site, overrideAccess: true }) }
      }
    }
    return null
  })()

  if (publishCandidate !== null) {
    try {
      const scheduledFor = new Date(Date.now() + 100_000).toISOString()
      const plan = await createPublicationPlan(payload, {
        editionId: publishCandidate.edition.id,
        scheduledFor,
        timezone: publishCandidate.site.timezone || "UTC",
        user: publisher,
      })
      console.log(JSON.stringify({ code: "SEED_PLAN_CREATED", editionId: publishCandidate.edition.id, planId: plan.planId }))
      const planDeadline = Date.now() + 6 * 60_000
      let planStatus = "pending"
      while (Date.now() < planDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 8_000))
        const stored = await payload.find({
          collection: "publication-plans",
          depth: 0,
          limit: 1,
          overrideAccess: true,
          where: { planId: { equals: plan.planId } },
        })
        planStatus = stored.docs[0]?.status ?? planStatus
        if (planStatus === "succeeded" || planStatus === "failed" || planStatus === "cancelled") break
      }
      summary.published = { editionId: publishCandidate.edition.id, planId: plan.planId, status: planStatus }
      console.log(JSON.stringify({ code: "SEED_PLAN_SETTLED", status: planStatus }))
    } catch (error) {
      console.log(JSON.stringify({ code: "SEED_PUBLISH_FAILED", error: String(error).slice(0, 160) }))
    }
  }

  console.log("SEED_SUMMARY_BEGIN")
  console.log(JSON.stringify(summary, null, 1))
  console.log("SEED_SUMMARY_END")
} finally {
  void payload.destroy()
}
