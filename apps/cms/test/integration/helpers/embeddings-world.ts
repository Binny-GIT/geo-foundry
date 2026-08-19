import { sql } from "@payloadcms/db-postgres"
import { getPayload, type Payload, type PayloadRequest } from "payload"

import { allInternalEndpoints as internalEndpoints } from "../../../src/endpoints/internal/index"
import { resetInternalGuardsForTests } from "../../../src/endpoints/internal/guards"
import { EMBEDDING_DIMENSION } from "../../../src/services/embedding-store"
import config from "../../../src/payload.config"
import type { ContentEdition, Site, Tenant, User } from "../../../src/payload-types"

const asUser = (user: User) => ({ overrideAccess: false as const, user })

export const DIM = EMBEDDING_DIMENSION
export const MODEL = "fake-embedding-v1"
export const SHA = "a".repeat(64)

/** Deterministic unit vector whose cosine with e1 equals `similarity`. */
export const vectorWithSimilarity = (similarity: number): number[] => {
  const vector = Array.from({ length: DIM }, () => 0)
  vector[0] = similarity
  vector[1] = Math.sqrt(Math.max(0, 1 - similarity * similarity))
  return vector
}

export const queryVector = (): number[] =>
  Array.from({ length: DIM }, (_, index) => (index === 0 ? 1 : 0))

const endpointHandler = (path: string) => {
  const endpoint = internalEndpoints.find((candidate) => candidate.path === path)
  if (endpoint === undefined) {
    throw new Error(`missing endpoint ${path}`)
  }
  return endpoint.handler
}

export const callEmbeddingEndpoint = async (
  path: string,
  options: { body?: unknown; id?: number; payload?: Payload; user?: unknown } = {},
): Promise<Response> => {
  const bodyText = options.body === undefined ? "" : JSON.stringify(options.body)
  const req = {
    headers: new Headers({ "x-request-id": "req-embed-integration" }),
    json: async () => JSON.parse(bodyText.length === 0 ? "{}" : bodyText),
    method: "post",
    payload: options.payload,
    routeParams: { id: String(options.id ?? 0) },
    text: async () => bodyText,
    user: options.user ?? null,
  } as unknown as PayloadRequest
  return endpointHandler(path)(req)
}

export type EmbeddingWorld = {
  payload: Payload
  tenant: Tenant
  siteA: Site
  siteB: Site
  serviceUser: User
  foreignServiceUser: User
  editor: User
  foreignEditor: User
  queryEdition: number
  nearDuplicate: number
  distinctEdition: number
  sameSiteNeighbour: number
  titleTwin: number
  foreignEdition: number
  store: (id: number, user: unknown, body: Record<string, unknown>) => Promise<Response>
  seedContentVector: (
    editionId: number,
    modelId: string,
    similarity: number,
    hash: string,
  ) => Promise<Response>
  similarQuery: (user: unknown, body: Record<string, unknown>) => Promise<Response>
  makeEdition: (actor: User, siteId: number, tenantId: number, title: string) => Promise<number>
  destroy: () => Promise<void>
}

export const setupEmbeddingsWorld = async (): Promise<EmbeddingWorld> => {
  resetInternalGuardsForTests()
  const payload = (await getPayload({ config })) as Payload
  await payload.db.drizzle.execute(sql`DELETE FROM geo_foundry.embeddings`)
  for (const collection of [
    "outbox-events",
    "quality-assessments",
    "content-editions",
    "contents",
    "domains",
    "sites",
    "users",
    "tenants",
  ] as const) {
    await payload.delete({ collection, where: {}, overrideAccess: true })
  }
  const bootstrap = (await payload.create({
    collection: "users",
    data: {
      email: "embed-boot@geo-foundry.test",
      password: "bootstrap-password-260818",
      role: "editor",
    },
  })) as User
  const tenant = (await payload.create({
    collection: "tenants",
    data: { name: "embed-tenant" },
    ...asUser(bootstrap),
  })) as Tenant
  const foreignTenant = (await payload.create({
    collection: "tenants",
    data: { name: "embed-foreign-tenant" },
    ...asUser(bootstrap),
  })) as Tenant
  const adminOf = async (email: string, tenantId: number, password: string) =>
    (await payload.create({
      collection: "users",
      data: { email, password, role: "tenant-admin", tenant: tenantId },
      ...asUser(bootstrap),
    })) as User
  const tenantAdmin = await adminOf("embed-tenant-admin@geo-foundry.test", tenant.id, "pw-1-tenant")
  const foreignAdmin = await adminOf(
    "embed-foreign-admin@geo-foundry.test",
    foreignTenant.id,
    "pw-1-foreign",
  )
  const siteOf = async (actor: User, name: string, tenantId: number, locale: string) =>
    (await payload.create({
      collection: "sites",
      data: { locale, name, status: "active", tenant: tenantId, timezone: "UTC" },
      ...asUser(actor),
    })) as Site
  const siteA = await siteOf(tenantAdmin, "Embed Site A", tenant.id, "en-US")
  const siteB = await siteOf(tenantAdmin, "Embed Site B", tenant.id, "sv-SE")
  const foreignSite = await siteOf(foreignAdmin, "Embed Foreign", foreignTenant.id, "de-DE")
  const userOf = async (
    actor: User,
    email: string,
    tenantId: number,
    role: "content-service" | "editor",
    password: string,
  ) =>
    (await payload.create({
      collection: "users",
      data: { email, password, role, tenant: tenantId },
      ...asUser(actor),
    })) as User
  const serviceUser = await userOf(
    tenantAdmin,
    "embed-service@geo-foundry.test",
    tenant.id,
    "content-service",
    "pw-1-service",
  )
  const foreignServiceUser = await userOf(
    foreignAdmin,
    "embed-foreign-service@geo-foundry.test",
    foreignTenant.id,
    "content-service",
    "pw-1-foreign-service",
  )
  const editor = await userOf(
    tenantAdmin,
    "embed-editor@geo-foundry.test",
    tenant.id,
    "editor",
    "pw-1-editor",
  )
  const foreignEditor = await userOf(
    foreignAdmin,
    "embed-foreign-editor@geo-foundry.test",
    foreignTenant.id,
    "editor",
    "pw-1-foreign-editor",
  )
  let editionSeq = 0
  const makeEdition = async (actor: User, siteId: number, tenantId: number, title: string) => {
    editionSeq += 1
    const content = await payload.create({
      collection: "contents",
      data: {
        topic: `Embedding topic ${editionSeq}`,
        intent: "Semantic similarity isolation",
        tenant: tenantId,
        createdBy: "human",
      },
      ...asUser(actor),
    })
    const edition = (await payload.create({
      collection: "content-editions",
      data: {
        angle: `embedding-angle-${editionSeq}`,
        body: [
          { blockType: "heading", level: "2", text: "Integration heading" },
          { blockType: "paragraph", text: "Deterministic embedding candidate paragraph." },
        ],
        content: content.id,
        creationOrigin: "human",
        primaryTopic: "embeddings",
        site: siteId,
        summary: "Summary for embedding isolation.",
        tenant: tenantId,
        title,
      },
      ...asUser(actor),
    })) as ContentEdition
    return edition.id
  }
  const store = (id: number, user: unknown, body: Record<string, unknown>) =>
    callEmbeddingEndpoint("/internal/editions/:id/embeddings", { body, id, payload, user })
  const seedContentVector = (
    editionId: number,
    modelId: string,
    similarity: number,
    hash: string,
  ) =>
    store(editionId, serviceUser, {
      dimension: DIM,
      inputHash: hash,
      modelId,
      scope: "content",
      vector: vectorWithSimilarity(similarity),
    })
  let queryEdition = 0
  const similarQuery = (user: unknown, body: Record<string, unknown>) =>
    callEmbeddingEndpoint("/internal/editions/:id/similarity", {
      body: { dimension: DIM, limit: 5, modelId: MODEL, ...body },
      id: queryEdition,
      payload,
      user,
    })
  queryEdition = await makeEdition(editor, siteA.id, tenant.id, "Query edition on site A")
  return {
    payload,
    tenant,
    siteA,
    siteB,
    serviceUser,
    foreignServiceUser,
    editor,
    foreignEditor,
    queryEdition,
    nearDuplicate: await makeEdition(editor, siteB.id, tenant.id, "Near duplicate on site B"),
    distinctEdition: await makeEdition(editor, siteB.id, tenant.id, "Distinct angle on site B"),
    sameSiteNeighbour: await makeEdition(editor, siteA.id, tenant.id, "Same-site neighbour"),
    titleTwin: await makeEdition(editor, siteA.id, tenant.id, "Same-site title twin"),
    foreignEdition: await makeEdition(
      foreignEditor,
      foreignSite.id,
      foreignTenant.id,
      "Foreign tenant twin",
    ),
    store,
    seedContentVector,
    similarQuery,
    makeEdition,
    destroy: async () => {
      await payload.db.drizzle.execute(sql`DELETE FROM geo_foundry.embeddings`)
      await payload.destroy()
    },
  }
}

export const errorCodeOf = async (response: Response): Promise<string> =>
  (
    (JSON.parse(await response.text()) as Record<string, unknown>)["error"] as Record<
      string,
      unknown
    >
  )["code"] as string
