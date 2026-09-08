/*
 * 媒体上传与读取：POST /api/media（multipart：file + alt + caption）与
 * GET /api/media/file/:filename。对象键 = <mediaPrefix>/tenants/<tenant>/<filename>，
 * 与原 Payload s3Storage(useCompositePrefixes) 布局一致，历史对象可直接读回。
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { and, eq } from "drizzle-orm"

import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../../access/policy"
import { ALLOWED_MEDIA_MIME_TYPES, MAX_MEDIA_BYTES } from "../../media/upload-policy"
import { authenticateRequest } from "../auth/session"
import { media } from "../db/entity-schema"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorJson = (status: number, code: string, message?: string): Response =>
  json(status, { errors: [{ message: message ?? code }], message: message ?? code })

const safeFilename = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? ""
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "")
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "upload"
}

const objectKeyOf = (mediaPrefix: string, tenantId: number, filename: string): string =>
  `${mediaPrefix}/tenants/${tenantId}/${filename}`

export const handleMediaUploadPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 1 || slug[0] !== "media") return null
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return errorJson(401, "CMS_UNAUTHENTICATED")
  if (!decideAccess(auth.claims, CMS_RESOURCE.MEDIA, CMS_ACTION.CREATE)) {
    return errorJson(403, "CMS_FORBIDDEN")
  }
  const tenantId = Number(auth.claims.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0)
    return errorJson(403, "CMS_MEDIA_TENANT_REQUIRED")
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return errorJson(400, "CMS_MEDIA_BODY_INVALID", "请以 multipart/form-data 上传文件")
  }
  const file = form.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return errorJson(400, "CMS_MEDIA_FILE_REQUIRED", "请选择要上传的图片文件")
  }
  if (!(ALLOWED_MEDIA_MIME_TYPES as readonly string[]).includes(file.type)) {
    return errorJson(400, "CMS_MEDIA_TYPE_UNSUPPORTED", "仅支持 PNG / JPEG / WebP / GIF")
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return errorJson(400, "CMS_MEDIA_FILE_TOO_LARGE", "文件超过 5 MB 上限")
  }
  const alt = String(form.get("alt") ?? "").trim()
  if (alt.length === 0) return errorJson(400, "CMS_MEDIA_ALT_REQUIRED", "请填写替代文本")
  const captionRaw = String(form.get("caption") ?? "").trim()
  const caption = captionRaw.length === 0 ? null : captionRaw
  const runtime = serverRuntime()
  const filename = await uniqueFilename(tenantId, safeFilename(file.name))
  const body = new Uint8Array(await file.arrayBuffer())
  await runtime.media.client.send(
    new PutObjectCommand({
      Body: body,
      Bucket: runtime.media.bucket,
      ContentLength: body.byteLength,
      ContentType: file.type,
      Key: objectKeyOf(runtime.media.mediaPrefix, tenantId, filename),
    }),
  )
  const rows = await runtime.db
    .insert(media)
    .values({
      alt,
      caption,
      filename,
      filesize: body.byteLength,
      mediaPath: `/media/tenants/${tenantId}/${filename}`,
      mimeType: file.type,
      prefix: `tenants/${tenantId}`,
      tenantId,
      url: `/api/media/file/${filename}`,
    })
    .returning()
  const row = rows[0]
  if (row === undefined) return errorJson(500, "CMS_MEDIA_CREATE_FAILED")
  return json(201, {
    doc: {
      alt: row.alt,
      caption: row.caption,
      filename: row.filename,
      filesize: body.byteLength,
      id: row.id,
      mediaPath: row.mediaPath,
      mimeType: row.mimeType,
      tenant: row.tenantId,
      url: row.url,
    },
  })
}

/** 同租户文件名冲突时追加短后缀（Payload 的 -1/-2 语义等价）。 */
const uniqueFilename = async (tenantId: number, filename: string): Promise<string> => {
  const db = serverRuntime().db
  const dot = filename.lastIndexOf(".")
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ""
  let candidate = filename
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const rows = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), eq(media.filename, candidate)))
      .limit(1)
    if (rows[0] === undefined) return candidate
    candidate = `${stem}-${attempt}${ext}`
  }
  return `${stem}-${Date.now()}${ext}`
}

export const handleMediaFileGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 3 || slug[0] !== "media" || slug[1] !== "file") return null
  const filename = decodeURIComponent(slug[2] ?? "")
  if (filename.length === 0 || filename.includes("/") || filename.includes("..")) {
    return errorJson(400, "CMS_MEDIA_FILENAME_INVALID")
  }
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return errorJson(401, "CMS_UNAUTHENTICATED")
  if (!decideAccess(auth.claims, CMS_RESOURCE.MEDIA, CMS_ACTION.READ)) {
    return errorJson(403, "CMS_FORBIDDEN")
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return errorJson(403, "CMS_FORBIDDEN")
  const runtime = serverRuntime()
  const rows = await runtime.db
    .select({ mimeType: media.mimeType, tenantId: media.tenantId })
    .from(media)
    .where(
      and(
        eq(media.filename, filename),
        ...(scope.kind === "global" ? [] : [eq(media.tenantId, scope.tenantId)]),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (row === undefined) return errorJson(404, "CMS_MEDIA_NOT_FOUND")
  try {
    const object = await runtime.media.client.send(
      new GetObjectCommand({
        Bucket: runtime.media.bucket,
        Key: objectKeyOf(runtime.media.mediaPrefix, row.tenantId, filename),
      }),
    )
    if (object.Body === undefined) return errorJson(404, "CMS_MEDIA_NOT_FOUND")
    const bytes = await object.Body.transformToByteArray()
    const body = new Uint8Array(new ArrayBuffer(bytes.byteLength))
    body.set(bytes)
    return new Response(body, {
      headers: {
        "cache-control": "private, max-age=3600",
        "content-length": String(bytes.byteLength),
        "content-type": object.ContentType ?? row.mimeType ?? "application/octet-stream",
      },
      status: 200,
    })
  } catch {
    return errorJson(404, "CMS_MEDIA_NOT_FOUND")
  }
}
