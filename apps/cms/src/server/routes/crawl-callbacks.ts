import { createHmac, timingSafeEqual } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { readFileCredential } from "../../config/credentials"
import { connectors, crawlJobs } from "../db/entity-schema"
import { currentIntegrationGuardConfig, integrationGuardOf } from "../http/integration-guards"
import { sendCrawlJobWithin } from "../jobs/pgboss"
import { serverRuntime } from "../runtime"

const notificationSchema = z
  .object({
    deliveryId: z.string().uuid(),
    jobId: z.string().regex(/^job_[0-9a-f]{16}$/),
    occurredAt: z.string().datetime({ offset: true }),
    status: z.enum(["succeeded", "failed"]),
  })
  .strict()

export const verifyCrawlSignature = (
  secret: string,
  timestamp: string | null,
  signature: string | null,
  raw: string,
  now = Date.now(),
): boolean => {
  if (
    timestamp === null ||
    !/^\d{10}$/.test(timestamp) ||
    signature === null ||
    !/^sha256=[0-9a-f]{64}$/.test(signature) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest()
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))
}

const json = (status: number, code: string): Response =>
  Response.json({ error: { code } }, { status })

export const handleCrawlCallback = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 2 || slug[0] !== "integration" || slug[1] !== "crawl-callbacks") return null
  const maxBytes = Math.min(16_384, currentIntegrationGuardConfig().maxBodyBytes)
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    return json(413, "CRAWL_BODY_TOO_LARGE")
  const reader = request.body?.getReader()
  if (reader === undefined) return json(400, "CRAWL_BODY_INVALID")
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return json(413, "CRAWL_BODY_TOO_LARGE")
    }
    chunks.push(part.value)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  const guarded = integrationGuardOf({
    actorKey: `crawl:${request.headers.get("x-forwarded-for") ?? "unknown"}`,
    bodyBytes: size,
    idempotencyKey: null,
  })
  if (guarded !== null) return guarded
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json(400, "CRAWL_BODY_INVALID")
  }
  const parsed = notificationSchema.safeParse(body)
  if (!parsed.success || request.headers.get("x-crawl-delivery-id") !== parsed.data.deliveryId) {
    return json(400, "CRAWL_BODY_INVALID")
  }
  const db = serverRuntime().db
  const rows = await db
    .select({ job: crawlJobs, secretReference: connectors.secretReference })
    .from(crawlJobs)
    .innerJoin(connectors, eq(connectors.id, crawlJobs.connectorId))
    .where(and(eq(crawlJobs.jobId, parsed.data.jobId), eq(crawlJobs.tenantId, connectors.tenantId)))
    .limit(1)
  const row = rows[0]
  if (row === undefined) return json(404, "CRAWL_JOB_NOT_FOUND")
  if (row.secretReference === null || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(row.secretReference)) {
    return json(401, "CRAWL_SIGNATURE_INVALID")
  }
  const directory = process.env["GEO_FOUNDRY_CRAWL_CREDENTIALS_DIR"]
  if (!directory) return json(503, "CRAWL_CREDENTIALS_UNAVAILABLE")
  const secret = readFileCredential(
    "GEO_FOUNDRY_CRAWL_CREDENTIALS_DIR",
    `${directory}/${row.secretReference}.callback-secret`,
  )
  if (
    !verifyCrawlSignature(
      secret,
      request.headers.get("x-crawl-timestamp"),
      request.headers.get("x-crawl-signature"),
      raw,
    )
  )
    return json(401, "CRAWL_SIGNATURE_INVALID")
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(crawlJobs)
      .where(eq(crawlJobs.id, row.job.id))
      .for("update")
    if (
      current === undefined ||
      current.deliveryId !== null ||
      current.state === "ingested" ||
      current.state === "failed"
    )
      return
    await tx
      .update(crawlJobs)
      .set({
        crawlStatus: parsed.data.status,
        deliveryId: parsed.data.deliveryId,
        notifiedAt: new Date(),
        state: "notified",
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, current.id))
    await sendCrawlJobWithin(tx, {
      kind: "crawl-ingest",
      jobId: parsed.data.jobId,
      parentIntakeItemId: current.parentIntakeItemId,
      tenantId: current.tenantId,
    })
  })
  return Response.json({ accepted: true }, { status: 202 })
}
