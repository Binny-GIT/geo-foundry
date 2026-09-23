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
  Pick<EditionSiteRow, "publishState" | "releaseId" | "urlRecordId" | "publishedAt">
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
 * 全局 routing manifest 的数据源（B2）：凡有 published 行且 active 的站点
 * 及其 canonical 域名。worker 在每站发布完成后取这份清单写 S3 全局 routing
 * （服务面 runtime 靠它做 host → site 解析）。published 历史行在文章归档后
 * 保留（该站 S3 指针不回退），站点因此继续留在清单里；站点撤下的 routing
 * 语义归 A4 的按站 DELETE。
 */
export const publishedSiteHostsOf = async (db: ServerDb): Promise<PublishedSiteHost[]> => {
  const rows = await db
    .select({ siteId: sites.id, canonicalDomain: domains.hostname })
    .from(editionSites)
    .innerJoin(sites, eq(sites.id, editionSites.siteId))
    .innerJoin(
      domains,
      and(
        eq(domains.siteId, editionSites.siteId),
        eq(domains.role, "canonical"),
        eq(domains.status, "active"),
      ),
    )
    .where(and(eq(editionSites.publishState, "published"), eq(sites.status, "active")))
    .orderBy(sites.id)
  // 一个站点至多一个 active canonical 域名；Map 兜底防重复行。
  return [...new Map(rows.map((row) => [row.siteId, row])).values()].map((row) => ({
    canonicalDomain: row.canonicalDomain,
    siteId: row.siteId,
  }))
}
