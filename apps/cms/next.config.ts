import { withPayload } from "@payloadcms/next/withPayload"
import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  output: "standalone",
  turbopack: {
    root: path.resolve(dirname, "../.."),
  },
  webpack: (config) => {
    // BullMQ optionally imports @valkey/valkey-glide; the CMS uses the Redis
    // driver only, so alias the optional module away instead of bundling it.
    config.resolve = config.resolve ?? {}
    config.resolve.alias = { ...config.resolve.alias, "@valkey/valkey-glide": false }
    return config
  },
} satisfies NextConfig

export default withPayload(nextConfig, { devBundleServerPackages: false })
