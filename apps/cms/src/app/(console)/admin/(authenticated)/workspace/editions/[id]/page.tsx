import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { EditionEditor } from "@/console/features/editions/components/EditionEditor"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"

import "@/console/styles/tokens.css"
import "@/console/styles/edition-preview.css"

export const dynamic = "force-dynamic"

type WorkspaceEditionEditPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

const versionCountOf = async (
  context: Awaited<ReturnType<typeof requireConsolePayloadContext>>,
  editionId: number,
): Promise<number> => {
  try {
    const versionStore = context.payload as unknown as {
      findVersions(options: {
        collection: string
        limit: number
        overrideAccess: boolean
        where: Record<string, unknown>
      }): Promise<{ totalDocs?: number }>
    }
    /* 调用方已成功读取该 draft 文档并通过 document access；版本计数只按
     * 已验证的 editionId 查询，避免 Payload readVersions 错误过滤。 */
    const result = await versionStore.findVersions({
      collection: "content-editions",
      limit: 1,
      overrideAccess: true,
      where: { parent: { equals: editionId } },
    })
    return typeof result.totalDocs === "number" ? result.totalDocs : 0
  } catch {
    return 0
  }
}

/** Console 原生文章编辑页：加载 draft 文档，替代原 (workspace) 树的 Payload 宿主。 */
const WorkspaceEditionEditPage = async ({ params }: WorkspaceEditionEditPageProps) => {
  const { id } = await params
  const editionId = Number.parseInt(id, 10)
  if (!Number.isSafeInteger(editionId) || editionId <= 0) notFound()
  const context = await requireConsolePayloadContext()
  if (!canConsole(context.session, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)) notFound()
  const readOnly = !canConsole(context.session, CMS_RESOURCE.EDITIONS, CMS_ACTION.UPDATE)
  let document: Record<string, unknown> | null = null
  try {
    const found = await context.payload.findByID({
      collection: "content-editions",
      depth: 1,
      draft: true,
      id: editionId,
      overrideAccess: false,
      user: context.user,
    })
    // Date 等非纯 JSON 值统一转成 ISO 字符串，保证跨 RSC 边界的形状稳定。
    document = JSON.parse(JSON.stringify(found)) as Record<string, unknown>
  } catch {
    notFound()
  }
  const versionCount = await versionCountOf(context, editionId)
  return (
    <EditionEditor
      doc={document}
      readOnly={readOnly}
      session={{
        role: context.session.role,
        userId: typeof context.user["id"] === "number" ? context.user["id"] : null,
      }}
      versionCount={versionCount}
    />
  )
}

export default WorkspaceEditionEditPage
