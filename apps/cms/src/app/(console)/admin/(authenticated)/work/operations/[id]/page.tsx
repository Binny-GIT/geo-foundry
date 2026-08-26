import { notFound, redirect } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

type LegacyOperationWorkspaceProps = {
  readonly params: Promise<{ readonly id: string }>
}

const LegacyOperationWorkspacePage = async ({ params }: LegacyOperationWorkspaceProps) => {
  const { id } = await params
  const session = await requireConsoleSession(`/admin/work/operations/${encodeURIComponent(id)}`)
  if (!canConsole(session, CMS_RESOURCE.OPERATIONS, CMS_ACTION.READ)) notFound()
  redirect(`/admin/collections/operations/${encodeURIComponent(id)}`)
}

export default LegacyOperationWorkspacePage
