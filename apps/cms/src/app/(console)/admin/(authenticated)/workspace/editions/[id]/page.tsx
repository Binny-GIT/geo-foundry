import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { EditionEditor } from "@/console/features/editions/components/EditionEditor"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"
import { EditionsRepository } from "@/server/repositories/editions"
import { entityScopeFor } from "@/server/repositories/entities"
import { serverRuntime } from "@/server/runtime"

import "@/console/styles/tokens.css"
import "@/console/styles/edition-preview.css"

export const dynamic = "force-dynamic"

type WorkspaceEditionEditPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

/** Console 原生文章编辑页：认证、草稿和版本计数均不再依赖 Payload Local API。 */
const WorkspaceEditionEditPage = async ({ params }: WorkspaceEditionEditPageProps) => {
  const { id } = await params
  const editionId = Number.parseInt(id, 10)
  if (!Number.isSafeInteger(editionId) || editionId <= 0) notFound()

  const session = await requireConsoleSession(`/admin/workspace/editions/${id}`)
  if (!canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)) notFound()
  const scope = entityScopeFor({
    role: session.role,
    siteIds: session.siteIds ?? [],
    tenantId: session.tenantId,
  })
  if (scope === null) notFound()

  const repository = new EditionsRepository(serverRuntime().db)
  const [document, versionCount] = await Promise.all([
    repository.findDraft(scope, editionId),
    repository.versionCount(scope, editionId),
  ])
  if (document === null) notFound()

  const userId = Number(session.id)
  return (
    <EditionEditor
      doc={document}
      readOnly={!canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.UPDATE)}
      session={{
        role: session.role,
        userId: Number.isInteger(userId) && userId > 0 ? userId : null,
      }}
      versionCount={versionCount}
    />
  )
}

export default WorkspaceEditionEditPage
