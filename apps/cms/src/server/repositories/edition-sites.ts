/*
 * edition_sites（文章 × 站点）同步与按站读写：凡写文章 {site_id} ∪ sites[] 的地方
 * （新建草稿、保存草稿、站点分配、复制、采纳稿源）都在同一事务内调 sync，
 * 保持 edition_sites 与最新版本行一致。
 * - 新增站点：插 pending 行（ON CONFLICT 幂等）；
 * - 移出的站点：只删 pending 行——published/failed/unpublished 行保留，
 *   撤下站点的 gone 语义由 A4 的 DELETE /sites/{siteId} 负责。
 * A2 起发布链路（快照选文、发布扇出、编译/发布回执、URL 激活）按这里
 * 读的行做"文章 × 站点"守卫。
 */

import { and, eq, inArray, notInArray, sql } from "drizzle-orm"

import type { ServerDb } from "../db/client"
import { contentEditions, editionSites } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { domains } from "../db/session-schema"

export type EditionSitesTx = Parameters<Parameters<ServerDb["transaction"]>[0]>[0]

export type SyncEditionSitesInput = Readonly<{
  readonly editionId: number
  readonly siteId: number | null
  readonly sites: readonly number[]
  readonly tenantId: number | null
}>

export const desiredEditionSiteIdsOf = (
  input: Pick<SyncEditionSitesInput, "siteId"> & { sites?: readonly number[] | null },
) => {
  const ids = new Set<number>()
  if (input.siteId !== null) ids.add(input.siteId)
  for (const id of input.sites ?? []) ids.add(id)
  return [...ids]
}

export type DesiredSiteListInput = Readonly<{
  readonly siteId: number | null
  readonly sites: readonly number[] | null
}>

/**
 * A4：版本行目标站点集合的有序版本（{主站} ∪ sites[]，主站保持在前，
 * 去重、去非法值）。追加/撤下站点改写版本行 sites[] 用它保持
 * "sites[] = 主站在前的全集"不变式，主站顺延时取 [0]。
 */
export const desiredSiteListOf = (input: DesiredSiteListInput): number[] => {
  const primary = typeof input.siteId === "number" && input.siteId > 0 ? input.siteId : null
  const base = (input.sites ?? []).filter((id) => typeof id === "number" && id > 0)
  const ordered = primary === null ? [...base] : [primary, ...base.filter((id) => id !== primary)]
  return [...new Set(ordered)]
}

export const syncEditionSitesWithinTx = async (
  tx: EditionSitesTx,
  input: SyncEditionSitesInput,
): Promise<void> => {
  const desired = desiredEditionSiteIdsOf(input)
  for (const siteId of desired) {
    await tx
      .insert(editionSites)
      .values({
        editionId: input.editionId,
        publishState: "pending",
        qualityState: "pending",
        siteId,
        tenantId: input.tenantId,
      })
      .onConflictDoNothing({ target: [editionSites.editionId, editionSites.siteId] })
  }
  await tx
    .delete(editionSites)
    .where(
      and(
        eq(editionSites.editionId, input.editionId),
        ...(desired.length === 0 ? [] : [notInArray(editionSites.siteId, desired)]),
        eq(editionSites.publishState, "pending"),
      ),
    )
}

export type EditionSiteRow = typeof editionSites.$inferSelect

/** 读文章 × 站点 的行；没有行返回 null（调用方按"非成员站"处理）。 */
export const editionSiteRowOf = async (
  db: ServerDb | EditionSitesTx,
  editionId: number,
  siteId: number,
): Promise<EditionSiteRow | null> => {
  const rows = await db
    .select()
    .from(editionSites)
    .where(and(eq(editionSites.editionId, editionId), eq(editionSites.siteId, siteId)))
    .limit(1)
  return rows[0] ?? null
}

export type EditionSitePatch = Partial<
  Pick<
    EditionSiteRow,
    "publishState" | "releaseId" | "urlRecordId" | "publishedAt" | "qualityState"
  >
>

export const compileSitePatchOf = (
  row: Pick<EditionSiteRow, "publishState" | "releaseId">,
  releaseId: string,
): EditionSitePatch =>
  row.publishState === "published" && row.releaseId !== releaseId
    ? { publishState: "pending", publishedAt: null, releaseId, urlRecordId: null }
    : { releaseId }

/** 按 (editionId, siteId) 更新行；行不存在是静默 no-op（调用方已先行校验成员性）。 */
export const updateEditionSiteRow = async (
  db: ServerDb | EditionSitesTx,
  input: Readonly<{ editionId: number; patch: EditionSitePatch; siteId: number }>,
): Promise<void> => {
  await db
    .update(editionSites)
    .set({ ...input.patch, updatedAt: new Date() })
    .where(and(eq(editionSites.editionId, input.editionId), eq(editionSites.siteId, input.siteId)))
}

/**
 * 成员站点：文章最新版本 {site_id} ∪ sites[]（desired 已去重）中，
 * edition_sites 有行且未撤下（publish_state <> 'unpublished'）的站点，
 * 顺序与 desired 一致。发布扇出与审批 URL 预留共用它。
 */
export const activeMemberSiteIdsOf = (
  desired: readonly number[],
  rows: readonly { readonly publishState: string; readonly siteId: number }[],
): number[] => {
  const stateBySite = new Map(rows.map((row) => [row.siteId, row.publishState]))
  return desired.filter((id) => stateBySite.has(id) && stateBySite.get(id) !== "unpublished")
}

export const memberSiteIdsOf = async (
  db: ServerDb | EditionSitesTx,
  editionId: number,
  desired: readonly number[],
): Promise<number[]> => {
  if (desired.length === 0) return []
  const rows = await db
    .select({ publishState: editionSites.publishState, siteId: editionSites.siteId })
    .from(editionSites)
    .where(and(eq(editionSites.editionId, editionId), inArray(editionSites.siteId, desired)))
  return activeMemberSiteIdsOf(desired, rows)
}

/** 编译快照选文谓词：该站成员（未撤下）且 latest 版本行可编译。 */
export const editionSiteMemberSql = (siteId: number) =>
  sql`EXISTS (
    SELECT 1 FROM ${editionSites}
    WHERE ${editionSites.editionId} = ${contentEditions.id}
      AND ${editionSites.siteId} = ${siteId}
      AND ${editionSites.publishState} <> 'unpublished'
  )`

export type PublishedSiteHost = Readonly<{
  readonly canonicalDomain: string
  readonly siteId: number
}>

/**
 * 全局 routing manifest 的数据源（B2，A4 修订口径）：凡 active 且"仍有可
 * 服务内容"的站点及其 canonical 域名——有 published 文章行，**或**有
 * current release。worker 在每站发布完成后取这份清单写 S3 全局 routing
 * （服务面 runtime 靠它做 host → site 解析）。published 历史行在文章归档
 * 后保留（该站 S3 指针不回退），站点因此继续留在清单里；A4 撤下站点后
 * 该站会重发一个不含此文（可能是空站）的 release——站点外壳仍需可达，
 * 因此不能只按 published 行判定，否则撤下某站最后一篇文章会把整站从
 * routing 里摘除（服务面 503）。
 */
export const publishedSiteHostsOf = async (db: ServerDb): Promise<PublishedSiteHost[]> => {
  const rows = await db
    .select({ siteId: sites.id, canonicalDomain: domains.hostname })
    .from(sites)
    .innerJoin(
      domains,
      and(
        eq(domains.siteId, sites.id),
        eq(domains.role, "canonical"),
        eq(domains.status, "active"),
      ),
    )
    .where(
      and(
        eq(sites.status, "active"),
        sql`(
          EXISTS (SELECT 1 FROM edition_sites es
                  WHERE es.site_id = ${sites.id} AND es.publish_state = 'published')
          OR EXISTS (SELECT 1 FROM releases r
                     WHERE r.site_id = ${sites.id} AND r.state = 'current')
        )`,
      ),
    )
    .orderBy(sites.id)
  // 一个站点至多一个 active canonical 域名；Map 兜底防重复行。
  return [...new Map(rows.map((row) => [row.siteId, row])).values()].map((row) => ({
    canonicalDomain: row.canonicalDomain,
    siteId: row.siteId,
  }))
}
