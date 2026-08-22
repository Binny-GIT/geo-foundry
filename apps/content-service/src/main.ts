import { readFile } from "node:fs/promises"

import { ContentServiceClient } from "@geo/content-client"

import { createContentServiceServer } from "./http/server.js"

const required = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`CONTENT_SERVICE_ENV_REQUIRED:${name}`)
  }
  return value.trim()
}

const credential = async (name: string): Promise<string> => {
  const direct = process.env[name]
  if (direct !== undefined && direct.trim().length > 0) {
    return direct.trim()
  }
  const file = process.env[`${name}_FILE`]
  if (file === undefined || file.trim().length === 0) {
    throw new Error(`CONTENT_SERVICE_ENV_REQUIRED:${name}_FILE`)
  }
  const value = (await readFile(file, "utf8")).trim()
  if (value.length === 0) {
    throw new Error(`CONTENT_SERVICE_CREDENTIAL_EMPTY:${name}_FILE`)
  }
  return value
}

const portOf = (): number => {
  const raw = process.env["CONTENT_SERVICE_PORT"] ?? "3100"
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CONTENT_SERVICE_PORT_INVALID")
  }
  return port
}

const hostOf = (): "127.0.0.1" => {
  const host = process.env["CONTENT_SERVICE_HOST"] ?? "127.0.0.1"
  if (host !== "127.0.0.1") {
    throw new Error("CONTENT_SERVICE_LOOPBACK_BIND_REQUIRED")
  }
  return host
}

const main = async (): Promise<void> => {
  const server = createContentServiceServer({
    apiKey: await credential("CONTENT_SERVICE_OPERATOR_API_KEY"),
    client: new ContentServiceClient({
      apiKey: await credential("CONTENT_SERVICE_API_KEY"),
      baseUrl: required("CMS_BASE_URL"),
    }),
    host: hostOf(),
    port: portOf(),
  })
  const baseUrl = await server.listen()
  process.stdout.write(`${JSON.stringify({ code: "content-service.listening", baseUrl })}\n`)
  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

void main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "CONTENT_SERVICE_START_FAILED"
  process.stderr.write(`${JSON.stringify({ code })}\n`)
  process.exitCode = 1
})
