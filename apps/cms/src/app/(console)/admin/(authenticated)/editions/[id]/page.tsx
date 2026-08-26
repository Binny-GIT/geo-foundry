import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { ContentEditionStudio } from "@/console/components/ContentEditionStudio"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

type ContentEditionStudioPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

const ContentEditionStudioPage = async ({ params }: ContentEditionStudioPageProps) => {
  const { id } = await params
  const session = await requireConsoleSession(`/admin/editions/${encodeURIComponent(id)}`)
  if (!canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)) notFound()

  return (
    <ContentEditionStudio
      canEdit={canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.UPDATE)}
      editionId={id}
      role={session.role}
    />
  )
}

export default ContentEditionStudioPage
