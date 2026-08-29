import { RootPage } from "@payloadcms/next/views"
import config from "@payload-config"
import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

import { importMap } from "../../../../../(payload)/admin/importMap"

export const dynamic = "force-dynamic"

type WorkspaceEditionCreatePageProps = {
  readonly searchParams: Promise<Record<string, string | string[]>>
}

const WorkspaceEditionCreatePage = async ({ searchParams }: WorkspaceEditionCreatePageProps) => {
  const session = await requireConsoleSession("/admin/workspace/editions/new")
  if (!canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)) notFound()
  return RootPage({
    config,
    importMap,
    params: Promise.resolve({ segments: ["collections", "content-editions", "create"] }),
    searchParams,
  })
}

export default WorkspaceEditionCreatePage
