import { notFound, redirect } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

const LegacyReleaseHistoryPage = async () => {
  const session = await requireConsoleSession("/admin/history/releases")
  if (!canConsole(session, CMS_RESOURCE.RELEASES, CMS_ACTION.READ)) notFound()
  redirect("/admin/collections/releases")
}

export default LegacyReleaseHistoryPage
