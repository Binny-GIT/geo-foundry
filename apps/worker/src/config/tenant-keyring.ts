import { AsyncLocalStorage } from "node:async_hooks"

import { ContentServiceClient } from "@geo/content-client"
import { z } from "zod"

import { readWorkerCredentialFile } from "./credentials.js"

const keyringSchema = z.object({
  tenants: z.record(z.string().regex(/^\d+$/), z.string().min(1)),
})

const tenantScope = new AsyncLocalStorage<number>()

export const loadTenantKeyring = (environment: Record<string, string | undefined>) => {
  const path = environment["CONTENT_SERVICE_KEYRING_FILE"]?.trim()
  if (path === undefined || path.length === 0) {
    throw new Error("WORKER_CONTENT_SERVICE_KEYRING_REQUIRED")
  }
  let raw: unknown
  try {
    raw = JSON.parse(readWorkerCredentialFile("CONTENT_SERVICE_KEYRING_FILE", path))
  } catch {
    throw new Error("WORKER_CONTENT_SERVICE_KEYRING_INVALID")
  }
  const parsed = keyringSchema.safeParse(raw)
  if (!parsed.success) throw new Error("WORKER_CONTENT_SERVICE_KEYRING_INVALID")
  return new Map(Object.entries(parsed.data.tenants).map(([tenantId, apiKey]) => [Number(tenantId), apiKey]))
}

export const runForTenant = async <T>(tenantId: number | undefined, work: () => Promise<T>): Promise<T> =>
  tenantId === undefined ? work() : tenantScope.run(tenantId, work)

export const tenantClientProxy = (
  keyring: ReadonlyMap<number, string>,
  baseUrl: string,
): ContentServiceClient => {
  const clients = new Map<number, ContentServiceClient>()
  const current = (): ContentServiceClient => {
    const tenantId = tenantScope.getStore()
    if (tenantId === undefined) throw new Error("WORKER_TENANT_CLIENT_UNAVAILABLE")
    const apiKey = keyring.get(tenantId)
    if (apiKey === undefined) throw new Error("WORKER_TENANT_CLIENT_UNAVAILABLE")
    const existing = clients.get(tenantId)
    if (existing !== undefined) return existing
    const created = new ContentServiceClient({ apiKey, baseUrl })
    clients.set(tenantId, created)
    return created
  }
  return new Proxy({} as ContentServiceClient, {
    get: (_target, property) => {
      const value = current()[property as keyof ContentServiceClient]
      return typeof value === "function" ? value.bind(current()) : value
    },
  })
}
