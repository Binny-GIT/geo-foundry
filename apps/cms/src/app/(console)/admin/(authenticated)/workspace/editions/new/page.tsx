import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { EditionEditor } from "@/console/features/editions/components/EditionEditor"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

import "@/console/styles/tokens.css"
import "@/console/styles/edition-preview.css"

export const dynamic = "force-dynamic"

/** Console 原生新建文章页：只依赖 compat ConsoleSession，不初始化 Payload。 */
const WorkspaceEditionCreatePage = async () => {
  const session = await requireConsoleSession("/admin/workspace/editions/new")
  if (!canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)) notFound()
  const userId = Number(session.id)
  return (
    <EditionEditor
      doc={null}
      readOnly={false}
      session={{
        role: session.role,
        userId: Number.isInteger(userId) && userId > 0 ? userId : null,
      }}
      versionCount={0}
    />
  )
}

export default WorkspaceEditionCreatePage
