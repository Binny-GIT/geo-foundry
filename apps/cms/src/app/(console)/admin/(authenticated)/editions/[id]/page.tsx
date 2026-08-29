import { notFound, redirect } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

type LegacyEditionRouteProps = {
  readonly params: Promise<{ readonly id: string }>
}

const LegacyEditionRoute = async ({ params }: LegacyEditionRouteProps) => {
  const { id } = await params
  const session = await requireConsoleSession(`/admin/editions/${encodeURIComponent(id)}`)
  if (!canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)) notFound()

  redirect(`/admin/workspace/editions/${encodeURIComponent(id)}`)
}

export default LegacyEditionRoute
