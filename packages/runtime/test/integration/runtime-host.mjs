import { createServer } from "node:http"
import dns from "node:dns"
import net from "node:net"
import tls from "node:tls"

const required = (name) => {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`RUNTIME_HOST_ENV_REQUIRED:${name}`)
  }
  return value
}

const endpoint = new URL(required("GEO_FOUNDRY_RUNTIME_S3_ENDPOINT"))
const bucket = required("GEO_FOUNDRY_RUNTIME_S3_BUCKET")
const keyPrefix = required("GEO_FOUNDRY_RUNTIME_S3_KEY_PREFIX").replace(/\/$/, "")
const denyRustfs = process.env.GEO_FOUNDRY_RUNTIME_DENY_RUSTFS === "true"
const timeoutMs = Number(process.env.GEO_FOUNDRY_RUNTIME_S3_TIMEOUT_MS ?? "3000")
const events = []

const portOf = (value) => {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value)
  }
  return undefined
}

const connectionOf = (arguments_) => {
  const first = arguments_[0]
  if (typeof first === "object" && first !== null) {
    const options = first
    return { host: options.host ?? options.hostname ?? options.path, port: portOf(options.port) }
  }
  return { host: arguments_[0], port: portOf(arguments_[1]) }
}

const permitted = (host, port) => {
  const hostname = typeof host === "string" ? host.toLowerCase() : ""
  const targetPort = port ?? Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80))
  return hostname === endpoint.hostname.toLowerCase() && targetPort === Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80))
}

const recordConnection = (api, arguments_) => {
  const target = connectionOf(arguments_)
  const allowed = permitted(target.host, target.port) && !denyRustfs
  events.push({ allowed, api, host: typeof target.host === "string" ? target.host : "", port: target.port ?? null })
  if (!allowed) {
    const failure = new Error("RUNTIME_EGRESS_DENIED")
    failure.code = "RUNTIME_EGRESS_DENIED"
    throw failure
  }
}

const originalConnect = net.connect.bind(net)
net.connect = (...arguments_) => {
  recordConnection("net.connect", arguments_)
  return originalConnect(...arguments_)
}
net.createConnection = net.connect

const originalTlsConnect = tls.connect.bind(tls)
tls.connect = (...arguments_) => {
  recordConnection("tls.connect", arguments_)
  return originalTlsConnect(...arguments_)
}

const originalLookup = dns.lookup.bind(dns)
dns.lookup = (...arguments_) => {
  const hostname = arguments_[0]
  const allowed = typeof hostname === "string" && hostname.toLowerCase() === endpoint.hostname.toLowerCase()
  events.push({ allowed, api: "dns.lookup", host: typeof hostname === "string" ? hostname : "", port: null })
  if (!allowed) {
    const callback = arguments_.find((value) => typeof value === "function")
    if (typeof callback === "function") {
      queueMicrotask(() => callback(Object.assign(new Error("RUNTIME_EGRESS_DENIED"), { code: "RUNTIME_EGRESS_DENIED" })))
      return undefined
    }
    throw new Error("RUNTIME_EGRESS_DENIED")
  }
  return originalLookup(...arguments_)
}

const { GetObjectCommand, HeadObjectCommand, S3Client } = await import("@aws-sdk/client-s3")
const { createRuntime } = await import("../../dist/index.js")

const physicalKey = (key) => `${keyPrefix}/${key}`
const etagOf = (value) => (value === undefined ? '"-"' : `"${value.replaceAll('"', "")}"`)
const contentTypeOf = (value) => value ?? "application/octet-stream"
const access = []
const client = new S3Client({
  credentials: {
    accessKeyId: required("GEO_FOUNDRY_RUNTIME_S3_ACCESS_KEY"),
    secretAccessKey: required("GEO_FOUNDRY_RUNTIME_S3_SECRET_KEY"),
  },
  endpoint: endpoint.toString(),
  forcePathStyle: true,
  region: "rustfs",
})

const send = async (operation, key, command) => {
  const startedAt = Date.now()
  try {
    const output = await client.send(command, { abortSignal: AbortSignal.timeout(timeoutMs) })
    access.push({ bytes: output.ContentLength ?? null, key, operation, status: output.$metadata.httpStatusCode ?? null })
    return output
  } catch (error) {
    access.push({
      bytes: null,
      key,
      operation,
      status: typeof error === "object" && error !== null && "$metadata" in error ? error.$metadata?.httpStatusCode ?? null : null,
    })
    throw error
  } finally {
    void startedAt
  }
}

const reader = {
  async head(key) {
    try {
      const output = await send("HEAD", key, new HeadObjectCommand({ Bucket: bucket, Key: physicalKey(key) }))
      return {
        bytes: output.ContentLength ?? 0,
        contentType: contentTypeOf(output.ContentType),
        etag: etagOf(output.ETag),
      }
    } catch (error) {
      if (error instanceof Error && error.name === "NotFound") {
        return null
      }
      throw error
    }
  },
  async read(key) {
    try {
      const output = await send("GET", key, new GetObjectCommand({ Bucket: bucket, Key: physicalKey(key) }))
      const body = await output.Body?.transformToByteArray()
      if (body === undefined) {
        throw new Error("RUNTIME_S3_BODY_MISSING")
      }
      return {
        body: new Uint8Array(body),
        bytes: body.byteLength,
        contentType: contentTypeOf(output.ContentType),
        etag: etagOf(output.ETag),
      }
    } catch (error) {
      if (error instanceof Error && error.name === "NotFound") {
        return null
      }
      throw error
    }
  },
}

const runtime = createRuntime({ store: reader })
const respond = (response, result) => {
  if ("releaseId" in result) {
    response.setHeader("X-Geo-Release-Id", result.releaseId)
  }
  if (result.kind === "redirect") {
    response.writeHead(301, { Location: result.targetUrl })
    response.end()
    return
  }
  if (result.kind === "sitemap") {
    response.writeHead(200, { "Content-Type": result.contentType })
    response.end(result.body)
    return
  }
  if (result.kind === "page" || result.kind === "not-found") {
    response.writeHead(result.status, { "Content-Type": "application/json" })
    response.end(JSON.stringify(result.document))
    return
  }
  response.writeHead(result.status, { "Content-Type": "application/json" })
  response.end(JSON.stringify(result))
}

const server = createServer(async (request, response) => {
  const hostname = request.headers.host ?? ""
  const result = request.url === "/sitemap.xml"
    ? await runtime.resolveSitemap({ hostname })
    : await runtime.resolve({ hostname, pathname: request.url ?? "/" })
  respond(response, result)
})

const report = () => {
  const forbiddenAttempts = events.filter((event) => !event.allowed)
  return {
    access,
    environmentNames: Object.keys(process.env).sort(),
    egress: {
      attempts: events,
      forbiddenAttempts: forbiddenAttempts.length,
      forbiddenTargets: forbiddenAttempts.map(({ host, port }) => ({ host, port })),
      onlyApprovedDestinations: forbiddenAttempts.length === 0,
    },
  }
}

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  if (typeof address !== "object" || address === null) {
    throw new Error("RUNTIME_HOST_LISTEN_FAILED")
  }
  process.send?.({ kind: "ready", port: address.port })
})

process.on("message", (message) => {
  if (message !== "shutdown") {
    return
  }
  server.close(() => {
    client.destroy()
    process.send?.({ kind: "report", report: report() })
    process.exit(0)
  })
})
