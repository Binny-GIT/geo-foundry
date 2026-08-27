import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { IntakeInbox } from "@/console/components/IntakeInbox"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"

const CHANNELS = new Set(["manual", "url", "webhook", "rss"])
const STATUSES = new Set(["new", "fetching", "ready", "failed", "ignored", "duplicate", "adopted", "merged"])

type InboxPageProps = { readonly searchParams: Promise<{ readonly channel?: string; readonly status?: string }> }

export const metadata = { title: "Inbox | Geo Foundry" }

const InboxPage = async ({ searchParams }: InboxPageProps) => {
  const query = await searchParams
  const channel = CHANNELS.has(query.channel ?? "") ? query.channel ?? "" : ""
  const status = STATUSES.has(query.status ?? "") ? query.status ?? "" : ""
  const context = await requireConsolePayloadContext()
  if (!canConsole(context.session, CMS_RESOURCE.INTAKE_ITEMS, CMS_ACTION.READ)) notFound()
  const clauses = [channel ? { channel: { equals: channel } } : null, status ? { status: { equals: status } } : null].filter((value): value is NonNullable<typeof value> => value !== null)
  const result = await context.payload.find({ collection: "intake-items", depth: 1, limit: 50, overrideAccess: false, sort: "-receivedAt", user: context.user, ...(clauses.length > 0 ? { where: clauses.length === 1 ? clauses[0] : { and: clauses } } : {}) })
  return <IntakeInbox canManage={canConsole(context.session, CMS_RESOURCE.INTAKE_ITEMS, CMS_ACTION.UPDATE)} initialChannel={channel} initialItems={result.docs as unknown as readonly Record<string, unknown>[]} initialStatus={status} />
}

export default InboxPage
