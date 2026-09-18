/*
 * 稿源操作路由：create / ignore / merge / retry / adopt。
 * adopt 用事务包住 editions+article_sources+intake 写入。
 * create 对 webhook 通道支持直投正文（bodyMarkdown），并对外部工具的
 * API-Key 请求施加集成守卫（限流 / 请求体上限 / 幂等）。
 */

import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../../access/policy"
import { blocksToMarkdown, markdownToBlocks } from "../../editor/block-markdown"
import { validateEditionBody } from "../../editor/validate-body"
import { IntakeError, normalizeIntakeInput } from "../../services/intake"
import { enqueueIntakeFetchFromEnvironment } from "../../services/intake-queue"
import { authenticateRequest } from "../auth/session"
import { contentEditions, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { articleSources, intakeItems } from "../db/session-schema"
import {
  derivedIdempotencyHashOf,
  INTEGRATION_REQUEST_ID_PATTERN,
  integrationGuardOf,
  isDerivedIdempotencyHash,
} from "../http/integration-guards"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

export class IntakeOpsError extends Error {
  override readonly name = "IntakeOpsError"
  constructor(readonly code: string) {
    super(code)
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const statusOf = (code: string): number =>
  code === "INTAKE_ITEM_NOT_FOUND"
    ? 404
    : code === "INTAKE_TENANT_MISMATCH" ||
        code === "INTAKE_EDITOR_REQUIRED" ||
        code === "INTAKE_ACTOR_INVALID" ||
        code === "INTAKE_SITE_TENANT_MISMATCH"
      ? 403
      : code === "INTAKE_MERGE_SELF_REFERENCE" || code === "INTAKE_FETCH_STATE_INVALID"
        ? 409
        : 400

const idOf = (slug: readonly string[] | undefined): number | null => {
  const id = slug?.[1]
  return id !== undefined && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null
}

/*
 * 门禁走权限矩阵（policy.ts 是唯一权威）。四个角色的实际结果与旧的
 * editable() 硬编码完全一致：editor / tenant-admin / content-service
 * 通过，super-admin / publisher / reviewer 拒绝——这里是把矩阵变回权威，
 * 不是行为变更。
 */
const canOperateIntake = (
  claims: Parameters<typeof decideAccess>[0],
  action: "create" | "update",
): boolean =>
  decideAccess(
    claims,
    CMS_RESOURCE.INTAKE_ITEMS,
    action === "create" ? CMS_ACTION.CREATE : CMS_ACTION.UPDATE,
  )

const loadItem = async (
  tx: Parameters<Parameters<ReturnType<typeof serverRuntime>["db"]["transaction"]>[0]>[0],
  intakeItemId: number,
  tenantId: number | null,
): Promise<typeof intakeItems.$inferSelect> => {
  const rows = await tx.select().from(intakeItems).where(eq(intakeItems.id, intakeItemId)).limit(1)
  const item = rows[0]
  if (item === undefined) throw new IntakeOpsError("INTAKE_ITEM_NOT_FOUND")
  if (tenantId !== null && item.tenantId !== tenantId) {
    throw new IntakeOpsError("INTAKE_TENANT_MISMATCH")
  }
  return item
}

/*
 * 采纳成稿事务：人工采纳（Console 收件箱）与自动成稿（autoAdopt 密钥
 * 的 webhook 直投）共用同一份建稿规则——owner=投稿归属者、来源标注、
 * 版本快照、来源关联，两条路径永远一致。
 * siteIdOverride 是人工采纳对话框的显式站点选择；自动成稿不传，用
 * 条目自带的建议站点（create 阶段已做过入口校验与密钥默认站点回落）。
 */
const adoptIntakeItem = async (
  tx: Parameters<Parameters<ReturnType<typeof serverRuntime>["db"]["transaction"]>[0]>[0],
  intakeItemId: number,
  tenantId: number | null,
  siteIdOverride?: number,
): Promise<{ editionId: number; intakeItem: typeof intakeItems.$inferSelect }> => {
  const item = await loadItem(tx, intakeItemId, tenantId)
  const siteId = siteIdOverride ?? item.suggestedSiteId ?? null
  if (siteId === null) throw new IntakeOpsError("INTAKE_ADOPTION_SITE_REQUIRED")
  const siteRows = await tx
    .select({ tenantId: sites.tenantId })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1)
  const siteTenant = siteRows[0]?.tenantId
  if (siteTenant === undefined || siteTenant !== item.tenantId) {
    throw new IntakeOpsError("INTAKE_TENANT_MISMATCH")
  }
  const title = item.title ?? "Untitled intake"
  const summary = item.summary ?? title
  const blocks = Array.isArray(item.contentBlocks)
    ? (item.contentBlocks as unknown[]).filter(
        (block): block is Record<string, unknown> =>
          typeof block === "object" &&
          block !== null &&
          typeof (block as Record<string, unknown>)["blockType"] === "string",
      )
    : []
  const markdown = blocks.length > 0 ? blocksToMarkdown(blocks) : summary
  const citations =
    item.sourceUrl === null || item.sourceUrl === undefined
      ? []
      : [{ id: `intake-${item.id}`, title, url: item.sourceUrl }]
  const now = new Date()
  /*
   * 归属与来源：机器（gfa_ 密钥）采集的条目，文章 owner 落密钥创建者，
   * creationOrigin 标 'ai'（Console 文章详情显示「AI 生成」）；人工
   * 登记的线索保持无 owner + 人工创作，与既有行为一致。
   */
  const ownerId = item.createdById
  const creationOrigin = item.createdById === null ? "human" : "ai"
  const rootRows = await tx
    .insert(contentEditions)
    .values({
      angle: title,
      auditLog: [],
      bodyMarkdown: markdown,
      citations,
      compiledRelease: null,
      contentModifiedAt: now,
      creationOrigin,
      editorialStatus: "unassigned",
      entities: [],
      ownerId,
      primaryTopic: title,
      secondaryTopics: [],
      priority: "normal",
      siteId,
      sites: [siteId],
      summary,
      tenantId: item.tenantId,
      title,
      workflowRevision: 0,
      workflowStatus: "draft",
    })
    .returning({ id: contentEditions.id })
  const editionId = rootRows[0]?.id
  if (editionId === undefined) throw new IntakeOpsError("INTAKE_ADOPTION_FAILED")
  const versionRows = await tx
    .insert(editionVersions)
    .values({
      angle: title,
      auditLog: [],
      bodyMarkdown: markdown,
      citations,
      compiledRelease: null,
      contentModifiedAt: now,
      creationOrigin,
      editorialStatus: "unassigned",
      entities: [],
      latest: true,
      ownerId,
      parentId: editionId,
      primaryTopic: title,
      secondaryTopics: [],
      priority: "normal",
      siteId,
      sites: [siteId],
      summary,
      tenantId: item.tenantId,
      title,
      versionCreatedAt: now,
      versionUpdatedAt: now,
      workflowRevision: 0,
      workflowStatus: "draft",
    })
    .returning({ id: editionVersions.id })
  if (versionRows[0]?.id === undefined) throw new IntakeOpsError("INTAKE_ADOPTION_FAILED")
  await tx.insert(articleSources).values({
    editionId,
    intakeItemId: item.id,
    note: summary,
    role: "primary",
    tenantId: item.tenantId,
  })
  await tx
    .update(intakeItems)
    .set({ adoptedEditionId: editionId, status: "adopted", updatedAt: new Date() })
    .where(eq(intakeItems.id, item.id))
  return { editionId, intakeItem: item }
}

/*
 * 纯决策：webhook 直投是否触发自动成稿。四个条件缺一不可——密钥
 * 显式开启、直投正文（url/rss 抓取质量未验不直通）、非幂等重放
 * （重放不产生第二篇文章）、非重复、且站点已解析（显式值或密钥
 * 默认站点）。校验失败的请求在此之前已被 400 拒绝，不会走到这里。
 */
export const shouldAutoAdopt = (input: {
  readonly autoAdopt: boolean
  readonly directDrop: boolean
  readonly duplicate: boolean
  readonly replay: boolean
  readonly resolvedSiteId: number | undefined
}): boolean =>
  input.autoAdopt &&
  input.directDrop &&
  !input.replay &&
  !input.duplicate &&
  input.resolvedSiteId !== undefined

const rowOf = (item: typeof intakeItems.$inferSelect): Record<string, unknown> => ({
  channel: item.channel,
  contentHash: item.contentHash,
  createdBy: item.createdById,
  duplicateOf: item.duplicateOfId,
  duplicateStatus: item.duplicateStatus,
  failureCode: item.failureCode,
  failureReason: item.failureReason,
  id: item.id,
  mergedInto: item.mergedIntoId,
  sourceUrl: item.sourceUrl,
  status: item.status,
  suggestedSite: item.suggestedSiteId,
  summary: item.summary,
  tenant: item.tenantId,
  title: item.title,
})

const mergeSchema = z.object({ targetIntakeItemId: z.coerce.number().int().positive() }).strict()
const adoptSchema = z.object({ siteId: z.coerce.number().int().positive().optional() }).strict()

/*
 * 纯决策：投稿携带的 suggestedSiteId 是否可用。站点行缺失（undefined）
 * 与租户不符是两种错误：前者是站点不存在，后者是站点存在但不属于
 * 投稿租户——后者按越权处理给 403。
 */
export const intakeSiteScopeErrorOf = (
  siteTenantId: number | undefined,
  tenantId: number,
): "INTAKE_SITE_NOT_FOUND" | "INTAKE_SITE_TENANT_MISMATCH" | null =>
  siteTenantId === undefined
    ? "INTAKE_SITE_NOT_FOUND"
    : siteTenantId !== tenantId
      ? "INTAKE_SITE_TENANT_MISMATCH"
      : null

/*
 * 纯决策：投稿站点的最终取值。payload 显式值始终优先；缺失时回落到
 * 密钥默认站点；两者都没有则保持 undefined（由 normalize 按通道规则
 * 决定是否必填报错）。
 */
export const resolveSuggestedSiteId = (
  payloadSiteId: number | undefined,
  credentialDefaultSiteId: number | null,
): number | undefined => payloadSiteId ?? credentialDefaultSiteId ?? undefined

export const intakeOpsActionOf = (
  slug: readonly string[] | undefined,
): "create" | "ignore" | "merge" | "retry" | "adopt" | null => {
  if (slug?.length === 1 && slug[0] === "intake-operations") return "create"
  if (slug?.length !== 3 || slug[0] !== "intake-operations") return null
  if (slug[2] === "ignore" || slug[2] === "merge" || slug[2] === "retry" || slug[2] === "adopt") {
    return slug[2]
  }
  return null
}

const withEchoedRequestId = (request: Request, response: Response): Response => {
  const requestId = request.headers.get("x-request-id")
  if (requestId === null || !INTEGRATION_REQUEST_ID_PATTERN.test(requestId)) return response
  const headers = new Headers(response.headers)
  headers.set("x-request-id", requestId)
  return new Response(response.body, { headers, status: response.status })
}

export const handleIntakeOpsPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  const response = await handleIntakeOpsAction(request, slug)
  return response === null ? null : withEchoedRequestId(request, response)
}

const handleIntakeOpsAction = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  const action = intakeOpsActionOf(slug)
  if (action === null) return null
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "INTAKE_UNAUTHENTICATED" } })
  if (!canOperateIntake(auth.claims, action === "create" ? "create" : "update")) {
    return json(403, { error: { code: "INTAKE_EDITOR_REQUIRED" } })
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return json(403, { error: { code: "INTAKE_ACTOR_INVALID" } })
  const tenantId = scope.kind === "global" ? null : scope.tenantId
  const itemId = action === "create" ? 0 : (idOf(slug) ?? 0)
  if (action !== "create" && itemId === 0) {
    return json(400, { error: { code: "INTAKE_ITEM_ID_INVALID" } })
  }

  /*
   * API-Key 请求（session 为 null）走集成守卫：请求体上限、幂等键格式、
   * 每身份限流。Cookie 会话完全绕过，Console 行为不变。机器请求体只读
   * 一次，后续动作从缓存文本解析。
   */
  const machineBody = auth.session === null ? await request.text() : null
  if (machineBody !== null) {
    const guard = integrationGuardOf({
      actorKey: auth.claims.userId,
      bodyBytes: Buffer.byteLength(machineBody),
      idempotencyKey: request.headers.get("idempotency-key"),
    })
    if (guard !== null) return guard
  }
  const readBody = async (): Promise<unknown> =>
    machineBody !== null ? JSON.parse(machineBody) : request.json()

  let raw: unknown = {}
  if (action === "merge" || action === "adopt") {
    try {
      raw = await readBody()
    } catch {
      return json(400, { error: { code: "INTAKE_OPS_BODY_INVALID" } })
    }
  }

  const db = serverRuntime().db
  try {
    if (action === "create") {
      try {
        raw = await readBody()
      } catch {
        return json(400, { error: { code: "INTAKE_CREATE_BODY_INVALID" } })
      }
      const createSchema = z
        .object({
          bodyMarkdown: z.string().max(200_000).optional(),
          channel: z.enum(["manual", "url", "webhook", "rss"]),
          connectorId: z.coerce.number().int().positive().optional(),
          contentHash: z.string().trim().min(1).max(512).optional(),
          sourceUrl: z.string().trim().min(1).max(4_000).optional(),
          suggestedSiteId: z.coerce.number().int().positive().optional(),
          summary: z.string().trim().min(1).max(20_000).optional(),
          title: z.string().trim().min(1).max(1_000),
        })
        .strict()
      const parsed = createSchema.safeParse(raw)
      const tenantId = scope.kind === "global" ? null : scope.tenantId
      if (!parsed.success || tenantId === null) {
        return json(400, { error: { code: "INTAKE_CREATE_BODY_INVALID" } })
      }
      try {
        /*
         * 站点来源优先级：payload 显式值 > 密钥默认站点。回落只对
         * API-Key 身份生效（Console 会话 credential 为 null，行为不变）；
         * 合并后统一走 normalize 必填校验与入口站点校验。
         */
        const effectiveSuggestedSiteId = resolveSuggestedSiteId(
          parsed.data.suggestedSiteId,
          auth.credential?.defaultSiteId ?? null,
        )
        const normalized = normalizeIntakeInput({
          ...(parsed.data.bodyMarkdown === undefined
            ? {}
            : { bodyMarkdown: parsed.data.bodyMarkdown }),
          channel: parsed.data.channel,
          ...(parsed.data.connectorId === undefined
            ? {}
            : { connectorId: parsed.data.connectorId }),
          ...(parsed.data.contentHash === undefined
            ? {}
            : { contentHash: parsed.data.contentHash }),
          ...(parsed.data.sourceUrl === undefined ? {} : { sourceUrl: parsed.data.sourceUrl }),
          ...(effectiveSuggestedSiteId === undefined
            ? {}
            : { suggestedSiteId: effectiveSuggestedSiteId }),
          ...(parsed.data.summary === undefined ? {} : { summary: parsed.data.summary }),
          tenantId,
          title: parsed.data.title,
        })
        const bodyMarkdown = normalized.bodyMarkdown
        /* 直投正文按文章正文的同一套规则校验，坏内容在入口就拒掉。 */
        if (bodyMarkdown !== undefined && bodyMarkdown.length > 0) {
          const validation = validateEditionBody(markdownToBlocks(bodyMarkdown))
          if (validation !== true) {
            /*
             * code 是稳定错误码（外部工具按它分支）；validateEditionBody
             * 返回的本地化句子降级为 message。
             */
            return json(400, {
              error: { code: "INTAKE_BODY_BLOCKS_INVALID", message: validation },
              errors: [{ message: validation }],
            })
          }
        }
        /*
         * 站点校验前移：显式带 suggestedSiteId 的投稿（任意通道）在入口
         * 就校验站点存在性与租户归属。此前这道校验只在人工采纳时兜底，
         * 条目能带着跨租户的站点 id 躺进稿源箱；后续的自动成稿会跳过
         * 人工采纳，防线必须建在这里。采纳分支的原校验保留（纵深防御）。
         */
        if (normalized.suggestedSiteId !== undefined) {
          const siteRows = await db
            .select({ tenantId: sites.tenantId })
            .from(sites)
            .where(eq(sites.id, normalized.suggestedSiteId))
            .limit(1)
          const siteError = intakeSiteScopeErrorOf(siteRows[0]?.tenantId, tenantId)
          if (siteError !== null) {
            return json(statusOf(siteError), { error: { code: siteError } })
          }
        }
        /*
         * 幂等派生哈希：外部工具的重试不应在稿源箱留下重复行。优先级是
         * 调用方 contentHash（内容寻址）> webhook 正文哈希 > Idempotency-Key。
         * 派生值在事务里走「查到即原样返回、不插入」的快速路径。
         */
        const effectiveHash = derivedIdempotencyHashOf({
          ...(bodyMarkdown === undefined ? {} : { bodyMarkdown }),
          ...(normalized.contentHash === undefined ? {} : { contentHash: normalized.contentHash }),
          idempotencyKey: request.headers.get("idempotency-key"),
        })
        const hashForInsert = normalized.contentHash ?? effectiveHash
        const directDrop = bodyMarkdown !== undefined && bodyMarkdown.length > 0
        const result = await db.transaction(async (tx) => {
          if (isDerivedIdempotencyHash(hashForInsert)) {
            const replayRows = await tx
              .select()
              .from(intakeItems)
              .where(
                and(eq(intakeItems.tenantId, tenantId), eq(intakeItems.contentHash, hashForInsert)),
              )
              .limit(1)
            const existing = replayRows[0]
            if (existing !== undefined) {
              return { duplicates: [existing], item: existing, replay: true }
            }
          }
          const lowerTitle = normalized.title.trim().replace(/\s+/g, " ").toLocaleLowerCase()
          const candidates = await tx
            .select()
            .from(intakeItems)
            .where(eq(intakeItems.tenantId, tenantId))
            .limit(500)
          const duplicates = candidates.filter(
            (item) =>
              (normalized.normalizedUrl !== undefined &&
                item.normalizedUrl === normalized.normalizedUrl) ||
              (hashForInsert !== undefined && item.contentHash === hashForInsert) ||
              (item.title ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase() === lowerTitle,
          )
          const duplicateOf = duplicates[0]
          const inserted = await tx
            .insert(intakeItems)
            .values({
              /*
               * 机器投稿记归属：gfa_ 密钥绑定的是密钥创建者（认证层已
               * 覆写为 automation claims，userId 仍是真人）。Console 会话
               * 创建保持 NULL，与既有行为一致。
               */
              ...(auth.session === null ? { createdById: Number(auth.claims.userId) } : {}),
              ...(directDrop ? { contentBlocks: markdownToBlocks(bodyMarkdown) } : {}),
              channel: normalized.channel,
              ...(hashForInsert === undefined ? {} : { contentHash: hashForInsert }),
              ...(normalized.connectorId === undefined
                ? {}
                : { connectorId: normalized.connectorId }),
              ...(duplicateOf === undefined ? {} : { duplicateOfId: duplicateOf.id }),
              duplicateStatus: duplicateOf === undefined ? "unique" : "duplicate",
              ...(normalized.normalizedUrl === undefined
                ? {}
                : { normalizedUrl: normalized.normalizedUrl }),
              ...(normalized.sourceUrl === undefined ? {} : { sourceUrl: normalized.sourceUrl }),
              ...(normalized.suggestedSiteId === undefined
                ? {}
                : { suggestedSiteId: normalized.suggestedSiteId }),
              ...(normalized.summary === undefined ? {} : { summary: normalized.summary }),
              /* webhook 直投：内容已在手，直接进 ready，跳过抓取队列。 */
              status: duplicateOf === undefined ? (directDrop ? "ready" : "new") : "duplicate",
              tenantId,
              title: normalized.title,
            })
            .returning()
          const item = inserted[0]
          if (item === undefined) throw new IntakeOpsError("INTAKE_CREATE_FAILED")
          return { duplicates, item, replay: false }
        })
        const shouldFetch =
          result.duplicates.length === 0 &&
          (parsed.data.channel === "url" || parsed.data.channel === "rss")
        if (!shouldFetch) {
          /*
           * 自动成稿：autoAdopt 密钥的 webhook 直投在校验全过后直通
           * 工作台草稿。这是 intake 管道内部的系统事务（与人工采纳
           * 共用 adoptIntakeItem），automation 的权限面不因此扩大——
           * adopt 端点对密钥依然是 403，审核/发布仍是人工。
           * 成稿失败不吞投稿：条目留在收件箱 ready 等人工采纳。
           */
          const triggered = shouldAutoAdopt({
            autoAdopt: auth.credential?.autoAdopt === true,
            directDrop,
            duplicate: result.duplicates.length > 0,
            replay: result.replay === true,
            resolvedSiteId: normalized.suggestedSiteId,
          })
          if (triggered) {
            try {
              const adopted = await db.transaction((tx) =>
                adoptIntakeItem(tx, result.item.id, result.item.tenantId),
              )
              return json(201, {
                autoAdopted: true,
                duplicateIds: [],
                editionId: adopted.editionId,
                fetchQueued: false,
                idempotentReplay: false,
                intakeItem: rowOf({
                  ...adopted.intakeItem,
                  adoptedEditionId: adopted.editionId,
                  status: "adopted",
                }),
              })
            } catch {
              await db
                .update(intakeItems)
                .set({
                  failureCode: "INTAKE_AUTO_ADOPT_FAILED",
                  failureReason:
                    "Auto-adopt failed; the item stays in the intake inbox for manual adoption.",
                  updatedAt: new Date(),
                })
                .where(eq(intakeItems.id, result.item.id))
            }
          }
          return json(result.duplicates.length === 0 ? 201 : 200, {
            autoAdopted: result.item.status === "adopted",
            duplicateIds: result.duplicates.map((item) => item.id),
            editionId:
              result.item.adoptedEditionId === null ? undefined : result.item.adoptedEditionId,
            fetchQueued: false,
            idempotentReplay: result.replay === true,
            intakeItem: rowOf(result.item),
          })
        }
        try {
          await enqueueIntakeFetchFromEnvironment({
            intakeItemId: result.item.id,
            tenantId: result.item.tenantId,
          })
          await db
            .update(intakeItems)
            .set({ status: "fetching", updatedAt: new Date() })
            .where(eq(intakeItems.id, result.item.id))
          return json(201, {
            autoAdopted: false,
            duplicateIds: [],
            fetchQueued: true,
            intakeItem: rowOf({ ...result.item, status: "fetching" }),
          })
        } catch {
          await db
            .update(intakeItems)
            .set({
              failureCode: "INTAKE_QUEUE_UNAVAILABLE",
              failureReason:
                "The fetch task could not be queued. Retry this intake item when the worker is available.",
              status: "new",
              updatedAt: new Date(),
            })
            .where(eq(intakeItems.id, result.item.id))
          return json(202, {
            autoAdopted: false,
            duplicateIds: [],
            fetchQueued: false,
            intakeItem: rowOf({ ...result.item, status: "new" }),
          })
        }
      } catch (error) {
        if (error instanceof IntakeError) {
          return json(statusOf(error.code), { error: { code: error.code } })
        }
        throw error
      }
    }

    if (action === "ignore") {
      const item = await db.transaction(async (tx) => {
        await loadItem(tx, itemId, tenantId)
        await tx
          .update(intakeItems)
          .set({ status: "ignored", updatedAt: new Date() })
          .where(eq(intakeItems.id, itemId))
        const rows = await tx.select().from(intakeItems).where(eq(intakeItems.id, itemId)).limit(1)
        return rows[0]
      })
      if (item === undefined) throw new IntakeOpsError("INTAKE_ITEM_NOT_FOUND")
      return json(200, { intakeItem: rowOf(item) })
    }

    if (action === "merge") {
      const parsed = mergeSchema.safeParse(raw)
      if (!parsed.success) return json(400, { error: { code: "INTAKE_OPS_BODY_INVALID" } })
      if (itemId === parsed.data.targetIntakeItemId) {
        throw new IntakeOpsError("INTAKE_MERGE_SELF_REFERENCE")
      }
      const item = await db.transaction(async (tx) => {
        await loadItem(tx, itemId, tenantId)
        await loadItem(tx, parsed.data.targetIntakeItemId, tenantId)
        await tx
          .update(intakeItems)
          .set({
            duplicateOfId: parsed.data.targetIntakeItemId,
            duplicateStatus: "duplicate",
            mergedIntoId: parsed.data.targetIntakeItemId,
            status: "merged",
            updatedAt: new Date(),
          })
          .where(eq(intakeItems.id, itemId))
        const rows = await tx.select().from(intakeItems).where(eq(intakeItems.id, itemId)).limit(1)
        return rows[0]
      })
      if (item === undefined) throw new IntakeOpsError("INTAKE_ITEM_NOT_FOUND")
      return json(200, { intakeItem: rowOf(item) })
    }

    if (action === "retry") {
      const item = await db.transaction(async (tx) => {
        const loaded = await loadItem(tx, itemId, tenantId)
        if (loaded.channel !== "url" && loaded.channel !== "rss") {
          throw new IntakeOpsError("INTAKE_FETCH_CHANNEL_INVALID")
        }
        if (loaded.status !== "new" && loaded.status !== "failed") {
          throw new IntakeOpsError("INTAKE_FETCH_STATE_INVALID")
        }
        return loaded
      })
      await enqueueIntakeFetchFromEnvironment({ intakeItemId: item.id, tenantId: item.tenantId })
      await db
        .update(intakeItems)
        .set({ failureCode: null, failureReason: null, status: "fetching", updatedAt: new Date() })
        .where(eq(intakeItems.id, item.id))
      const rows = await db.select().from(intakeItems).where(eq(intakeItems.id, item.id)).limit(1)
      return json(202, { intakeItem: rowOf(rows[0] ?? item) })
    }

    const parsed = adoptSchema.safeParse(raw)
    if (!parsed.success) return json(400, { error: { code: "INTAKE_OPS_BODY_INVALID" } })
    /*
     * 采纳成文章是人的决定。所有 service 身份（Worker 的 content-service、
     * 外部工具的 automation）都在这里被拒——automation 还会被矩阵的
     * update=false 挡在前面，这里是纵深防御的第二层。autoAdopt 密钥的
     * 自动成稿不走这个端点：它是 create 管道内部的系统事务（见上），
     * 权限矩阵不变，automation 调这里仍然是 403。
     */
    if (auth.claims.kind === "service") {
      throw new IntakeOpsError("INTAKE_EDITOR_REQUIRED")
    }
    const result = await db.transaction((tx) =>
      adoptIntakeItem(tx, itemId, tenantId, parsed.data.siteId),
    )
    return json(200, {
      editionId: result.editionId,
      intakeItem: rowOf(result.intakeItem),
      sourceLinked: true,
      sourceLinkStatus: "created",
    })
  } catch (error) {
    const code = error instanceof IntakeOpsError ? error.code : "INTAKE_OPS_FAILED"
    return json(statusOf(code), { error: { code } })
  }
}
