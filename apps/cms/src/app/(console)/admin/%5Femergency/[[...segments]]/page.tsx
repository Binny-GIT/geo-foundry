import { RootPage, generatePageMetadata } from "@payloadcms/next/views"
import config from "@payload-config"
import type { Metadata } from "next"

import { requireEmergencySession } from "@/console/lib/session.server"

import { importMap } from "../../../../(payload)/admin/importMap"

type PageArguments = {
  readonly params: Promise<{ readonly segments: string[] }>
  readonly searchParams: Promise<Record<string, string | string[]>>
}

export const generateMetadata = ({ params, searchParams }: PageArguments): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })

const Page = async ({ params, searchParams }: PageArguments) => {
  await requireEmergencySession("/admin/_emergency")
  return RootPage({ config, params, searchParams, importMap })
}

export default Page
