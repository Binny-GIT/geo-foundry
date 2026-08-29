import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

const MAX_REDIRECTS = 3
const MAX_RESPONSE_BYTES = 2_000_000
const REQUEST_TIMEOUT_MS = 15_000
const USER_AGENT = "GeoFoundryIntake/1.0"

export class IntakeFetchError extends Error {
  override readonly name = "IntakeFetchError"

  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message = code,
  ) {
    super(message)
  }
}

const fail = (code: string, retryable = false, message?: string): IntakeFetchError =>
  new IntakeFetchError(code, retryable, message)

const ipv4Blocked = (address: string): boolean => {
  const values = address.split(".").map(Number)
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value))) return true
  const [a, b] = values
  if (a === undefined || b === undefined) return true
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  )
}

const ipv6Blocked = (address: string): boolean => {
  const normalized = address.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  return (
    normalized === "::" ||
    normalized === "::1" ||
    (mapped !== null && ipv4Blocked(mapped[1] ?? "")) ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  )
}

export const isPublicAddress = (address: string): boolean => {
  switch (isIP(address)) {
    case 4:
      return !ipv4Blocked(address)
    case 6:
      return !ipv6Blocked(address)
    default:
      return false
  }
}

type PinnedAddress = { readonly address: string; readonly family: 4 | 6 }

export function pinnedLookupResult(resolved: PinnedAddress, all: true): PinnedAddress[]
export function pinnedLookupResult(resolved: PinnedAddress, all: false): PinnedAddress
export function pinnedLookupResult(resolved: PinnedAddress, all: boolean): PinnedAddress | PinnedAddress[] {
  return all ? [{ ...resolved }] : resolved
}

const validateUrl = (value: string): URL => {
  if (value.length === 0 || value.length > 4_000) throw fail("INTAKE_URL_INVALID")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw fail("INTAKE_URL_INVALID")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fail("INTAKE_URL_PROTOCOL_INVALID")
  }
  if (url.username.length > 0 || url.password.length > 0 || url.hash.length > 0) {
    throw fail("INTAKE_URL_AUTHORITY_INVALID")
  }
  if (url.port.length > 0 && url.port !== "80" && url.port !== "443") {
    throw fail("INTAKE_URL_PORT_FORBIDDEN")
  }
  const hostname = url.hostname.toLowerCase()
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw fail("INTAKE_URL_PRIVATE_HOST")
  }
  return url
}

const publicAddressFor = async (hostname: string): Promise<{ address: string; family: 4 | 6 }> => {
  const literalFamily = isIP(hostname)
  if (literalFamily !== 0) {
    if (!isPublicAddress(hostname)) throw fail("INTAKE_URL_PRIVATE_ADDRESS")
    return { address: hostname, family: literalFamily as 4 | 6 }
  }
  let records: Awaited<ReturnType<typeof lookup>>[]
  try {
    records = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw fail("INTAKE_DNS_FAILED", true)
  }
  if (records.length === 0 || records.some((record) => !isPublicAddress(record.address))) {
    throw fail("INTAKE_URL_PRIVATE_ADDRESS")
  }
  const accepted = records[0]
  if (accepted === undefined) throw fail("INTAKE_DNS_FAILED", true)
  return { address: accepted.address, family: accepted.family as 4 | 6 }
}

const responseBody = async (
  response: import("node:http").IncomingMessage,
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    response.on("data", (chunk: Buffer) => {
      length += chunk.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        response.destroy(fail("INTAKE_RESPONSE_TOO_LARGE"))
        return
      }
      chunks.push(chunk)
    })
    response.once("end", () => resolve(new Uint8Array(Buffer.concat(chunks))))
    response.once("error", reject)
  })

export type IntakeHttpResponse = Readonly<{
  body: Uint8Array
  contentType: string
  finalUrl: string
  status: number
}>

const requestOnce = async (url: URL): Promise<{ body: Uint8Array; headers: import("node:http").IncomingHttpHeaders; status: number }> => {
  const resolved = await publicAddressFor(url.hostname)
  const request = url.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const client = request(
      url,
      {
        headers: { accept: "text/html,application/rss+xml,application/atom+xml,text/xml,application/xml,text/plain;q=0.8,*/*;q=0.1", "user-agent": USER_AGENT },
        lookup: (_hostname, options, callback) => {
          if (options.all === true) {
            callback(null, pinnedLookupResult(resolved, true))
            return
          }
          callback(null, resolved.address, resolved.family)
        },
        servername: url.protocol === "https:" ? url.hostname : undefined,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const declaredLength = Number(response.headers["content-length"] ?? "0")
        if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
          response.destroy(fail("INTAKE_RESPONSE_TOO_LARGE"))
          reject(fail("INTAKE_RESPONSE_TOO_LARGE"))
          return
        }
        const status = response.statusCode ?? 0
        void responseBody(response)
          .then((body) => resolve({ body, headers: response.headers, status }))
          .catch(reject)
      },
    )
    client.once("timeout", () => client.destroy(fail("INTAKE_FETCH_TIMEOUT", true)))
    client.once("error", (error) => {
      if (error instanceof IntakeFetchError) reject(error)
      else reject(fail("INTAKE_FETCH_NETWORK_FAILED", true))
    })
    client.end()
  })
}

/** Bounded, redirect-aware HTTP retrieval with DNS/IP checks on every hop. */
export const fetchPublicUrl = async (source: string): Promise<IntakeHttpResponse> => {
  let current = validateUrl(source)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await requestOnce(current)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location
      if (typeof location !== "string" || location.length === 0) throw fail("INTAKE_REDIRECT_INVALID")
      if (redirect === MAX_REDIRECTS) throw fail("INTAKE_REDIRECT_LIMIT")
      current = validateUrl(new URL(location, current).toString())
      continue
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw fail(`INTAKE_HTTP_${response.status}`, true)
    }
    if (response.status < 200 || response.status >= 300) throw fail(`INTAKE_HTTP_${response.status}`)
    const rawContentType = response.headers["content-type"]
    const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType ?? "application/octet-stream")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "application/octet-stream"
    return {
      body: response.body,
      contentType,
      finalUrl: current.toString(),
      status: response.status,
    }
  }
  throw fail("INTAKE_REDIRECT_LIMIT")
}
