import { NotFoundPage, generatePageMetadata } from "@payloadcms/next/views"
import config from "@payload-config"
import type { Metadata } from "next"

import { importMap } from "../importMap"

type NotFoundArguments = {
  readonly params: Promise<{ readonly segments: string[] }>
  readonly searchParams: Promise<Record<string, string | string[]>>
}

export const generateMetadata = ({ params, searchParams }: NotFoundArguments): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })

const NotFound = ({ params, searchParams }: NotFoundArguments) =>
  NotFoundPage({ config, params, searchParams, importMap })

export default NotFound
