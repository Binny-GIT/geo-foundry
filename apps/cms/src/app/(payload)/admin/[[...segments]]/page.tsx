import { RootPage, generatePageMetadata } from "@payloadcms/next/views"
import config from "@payload-config"
import type { Metadata } from "next"

import { importMap } from "../importMap"

type PageArguments = {
  readonly params: Promise<{ readonly segments: string[] }>
  readonly searchParams: Promise<Record<string, string | string[]>>
}

export const generateMetadata = ({ params, searchParams }: PageArguments): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })

const Page = ({ params, searchParams }: PageArguments) =>
  RootPage({ config, params, searchParams, importMap })

export default Page
