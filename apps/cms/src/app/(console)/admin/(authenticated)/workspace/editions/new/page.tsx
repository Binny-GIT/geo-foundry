import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { EditionEditor } from "@/console/features/editions/components/EditionEditor"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"

import "@/console/styles/tokens.css"
import "@/console/styles/edition-preview.css"

export const dynamic = "force-dynamic"

/** Console 原生新建文章页：替代原 (workspace) 树的 Payload RootPage 宿主。 */
const WorkspaceEditionCreatePage = async () => {
  const context = await requireConsolePayloadContext()
  if (!canConsole(context.session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)) notFound()
  return (
    <EditionEditor
      doc={null}
      readOnly={false}
      session={{
        role: context.session.role,
        userId: typeof context.user["id"] === "number" ? context.user["id"] : null,
      }}
      versionCount={0}
    />
  )
}

export default WorkspaceEditionCreatePage
