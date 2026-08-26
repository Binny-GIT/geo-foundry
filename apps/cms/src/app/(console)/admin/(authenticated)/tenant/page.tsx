import { redirect } from "next/navigation"

import { CMS_ROLE } from "@/access/roles"
import { requireConsoleSession } from "@/console/lib/session.server"

const LegacyTenantWorkspacePage = async () => {
  const session = await requireConsoleSession("/admin/tenant")
  redirect(session.role === CMS_ROLE.SUPER_ADMIN ? "/admin/collections/tenants" : "/admin/collections/sites")
}

export default LegacyTenantWorkspacePage
