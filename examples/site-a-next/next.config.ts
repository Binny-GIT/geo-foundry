import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  output: "standalone",
  turbopack: { root: path.resolve(dirname, "../..") },
} satisfies NextConfig

export default nextConfig
