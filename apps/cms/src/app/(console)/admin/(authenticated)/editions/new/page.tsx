import { notFound, redirect } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

const NewContentEditionPage = async () => {
  const session = await requireConsoleSession("/admin/editions/new")
  if (!canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)) notFound()
  redirect("/admin/collections/content-editions/create")
}

export default NewContentEditionPage
