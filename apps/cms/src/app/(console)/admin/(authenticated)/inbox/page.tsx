import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { IntakeInbox } from "@/console/components/IntakeInbox"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import { canConsole } from "@/console/lib/session.server"
import { listInboxItems } from "@/server/repositories/console-reads"

const CHANNELS = new Set(["manual", "url", "webhook", "rss"])
const STATUSES = new Set([
  "new",
  "fetching",
  "ready",
  "failed",
  "ignored",
  "duplicate",
  "adopted",
  "merged",
])

type InboxPageProps = {
  readonly searchParams: Promise<{ readonly channel?: string; readonly status?: string }>
}

export const metadata = { title: "Inbox | Geo Foundry" }

const InboxPage = async ({ searchParams }: InboxPageProps) => {
  const query = await searchParams
  const channel = CHANNELS.has(query.channel ?? "") ? (query.channel ?? "") : ""
  const status = STATUSES.has(query.status ?? "") ? (query.status ?? "") : ""
  const context = await requireConsoleContext()
  if (!canConsole(context.session, CMS_RESOURCE.INTAKE_ITEMS, CMS_ACTION.READ)) notFound()
  const items = await listInboxItems(context.db, context.scope, { channel, status })
  return (
    <IntakeInbox
      canManage={canConsole(context.session, CMS_RESOURCE.INTAKE_ITEMS, CMS_ACTION.UPDATE)}
      initialChannel={channel}
      initialItems={items}
      initialStatus={status}
    />
  )
}

export default InboxPage
