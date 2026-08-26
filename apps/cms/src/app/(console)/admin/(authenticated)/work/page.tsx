import { redirect } from "next/navigation"

import { requireConsoleSession } from "@/console/lib/session.server"

const LegacyWorkQueuePage = async () => {
  await requireConsoleSession("/admin/work")
  redirect("/admin")
}

export default LegacyWorkQueuePage
