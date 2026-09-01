import config from "@payload-config"
import { RootPage } from "@payloadcms/next/views"
import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

import { importMap } from "../../../../../(payload)/admin/importMap"

export const dynamic = "force-dynamic"

type WorkspaceEditionPageProps = {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<Record<string, string | string[]>>
}

const WorkspaceEditionPage = async ({ params, searchParams }: WorkspaceEditionPageProps) => {
  const { id } = await params
  const editionId = Number(id)
  const session = await requireConsoleSession(`/admin/workspace/editions/${encodeURIComponent(id)}`)
  if (
    !Number.isInteger(editionId) ||
    editionId <= 0 ||
    !canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)
  ) {
    notFound()
  }
  return RootPage({
    config,
    importMap,
    params: Promise.resolve({ segments: ["collections", "content-editions", id] }),
    searchParams,
  })
}

export default WorkspaceEditionPage
