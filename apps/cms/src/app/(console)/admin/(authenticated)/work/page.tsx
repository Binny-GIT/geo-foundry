import type { Where } from "payload"

import { CMS_RESOURCE } from "@/access/policy"
import { TodayWork } from "@/console/components/TodayWork"
import type { PerformanceSuggestion } from "@/console/components/PerformanceSuggestions"
import { consoleRoute } from "@/console/lib/resources"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"
import { performanceSuggestions } from "@/services/performance-snapshots"

export const metadata = { title: "Today Work | Geo Foundry" }

const visibleEditions = async (
  context: Awaited<ReturnType<typeof requireConsolePayloadContext>>,
  where: Where,
) =>
  context.payload.find({
    collection: "content-editions",
    depth: 1,
    limit: 50,
    overrideAccess: false,
    sort: "dueAt",
    user: context.user,
    where,
  })

const TodayWorkPage = async () => {
  const context = await requireConsolePayloadContext()
  const role = context.session.role
  const userId = context.session.id

  const ownedEditions =
    role === "editor" || role === "tenant-admin"
      ? await visibleEditions(context, { owner: { equals: userId } })
      : { docs: [] }
  const reviewEditions =
    role === "reviewer"
      ? await visibleEditions(context, { workflowStatus: { equals: "review" } })
      : { docs: [] }
  const publisherEditions =
    role === "publisher"
      ? await visibleEditions(context, {
          or: [{ workflowStatus: { equals: "approved" } }, { workflowStatus: { equals: "compiled" } }],
        })
      : { docs: [] }
  const failedOperations = canConsole(context.session, CMS_RESOURCE.OPERATIONS, "read")
    ? await context.payload.find({
        collection: "operations",
        depth: 0,
        limit: 20,
        overrideAccess: false,
        sort: "-updatedAt",
        user: context.user,
        where: { state: { equals: "failed" } },
      })
    : { docs: [] }

  const rawSuggestions =
    role === "editor" || role === "tenant-admin"
      ? await performanceSuggestions(context.payload, context.user)
      : []
  const suggestionEditions =
    rawSuggestions.length > 0
      ? await context.payload.find({
          collection: "content-editions",
          depth: 1,
          limit: 20,
          overrideAccess: false,
          user: context.user,
          where: { id: { in: rawSuggestions.map((suggestion) => suggestion.editionId) } },
        })
      : { docs: [] as unknown[] }
  const editionLabel = (edition: unknown): { id: number; site: string; title: string } | null => {
    if (typeof edition !== "object" || edition === null) return null
    const record = edition as Record<string, unknown>
    const id = typeof record["id"] === "number" ? record["id"] : null
    if (id === null) return null
    const siteRecord = record["site"]
    const siteName =
      typeof siteRecord === "object" && siteRecord !== null && typeof (siteRecord as Record<string, unknown>)["name"] === "string"
        ? String((siteRecord as Record<string, unknown>)["name"])
        : "Restricted site"
    return {
      id,
      site: siteName,
      title: typeof record["title"] === "string" && record["title"].length > 0 ? record["title"] : "Untitled edition",
    }
  }
  const editionsById = new Map(
    suggestionEditions.docs.flatMap((edition) => {
      const labeled = editionLabel(edition)
      return labeled === null ? [] : [[labeled.id, labeled] as const]
    }),
  )
  const suggestions: readonly PerformanceSuggestion[] = rawSuggestions.flatMap((suggestion) => {
    const edition = editionsById.get(suggestion.editionId)
    if (edition === undefined) return []
    return [
      {
        current: suggestion.visits.current,
        editionId: suggestion.editionId,
        href: consoleRoute.document("content-editions", String(suggestion.editionId)),
        previous: suggestion.visits.previous,
        site: edition.site,
        title: edition.title,
      },
    ]
  })

  return (
    <TodayWork
      failedOperations={failedOperations.docs as unknown as readonly Record<string, unknown>[]}
      ownedEditions={ownedEditions.docs as unknown as readonly Record<string, unknown>[]}
      publisherEditions={publisherEditions.docs as unknown as readonly Record<string, unknown>[]}
      reviewEditions={reviewEditions.docs as unknown as readonly Record<string, unknown>[]}
      suggestions={suggestions}
    />
  )
}

export default TodayWorkPage
