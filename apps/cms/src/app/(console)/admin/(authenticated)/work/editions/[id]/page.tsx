import { notFound, redirect } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

type LegacyEditionWorkspaceProps = {
  readonly params: Promise<{ readonly id: string }>
}

const LegacyEditionWorkspacePage = async ({ params }: LegacyEditionWorkspaceProps) => {
  const { id } = await params
  const session = await requireConsoleSession(`/admin/work/editions/${encodeURIComponent(id)}`)
  if (!canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)) notFound()
  redirect(`/admin/editions/${encodeURIComponent(id)}`)
}

export default LegacyEditionWorkspacePage
