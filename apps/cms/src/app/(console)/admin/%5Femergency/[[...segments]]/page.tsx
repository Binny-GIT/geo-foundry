import config from "@payload-config"
import { generatePageMetadata, RootPage } from "@payloadcms/next/views"
import type { Metadata } from "next"

import { requireEmergencySuperAdmin } from "@/console/lib/session.server"

import { importMap } from "../../../../(payload)/admin/importMap"

type PageArguments = {
  readonly params: Promise<{ readonly segments: string[] }>
  readonly searchParams: Promise<Record<string, string | string[]>>
}

export const generateMetadata = ({ params, searchParams }: PageArguments): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })

const Page = async ({ params, searchParams }: PageArguments) => {
  await requireEmergencySuperAdmin()
  return RootPage({ config, params, searchParams, importMap })
}

export default Page
