import type { Where } from "payload"

import { CMS_RESOURCE } from "@/access/policy"
import { TodayWork } from "@/console/components/TodayWork"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"

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

  return (
    <TodayWork
      failedOperations={failedOperations.docs as unknown as readonly Record<string, unknown>[]}
      ownedEditions={ownedEditions.docs as unknown as readonly Record<string, unknown>[]}
      publisherEditions={publisherEditions.docs as unknown as readonly Record<string, unknown>[]}
      reviewEditions={reviewEditions.docs as unknown as readonly Record<string, unknown>[]}
    />
  )
}

export default TodayWorkPage
