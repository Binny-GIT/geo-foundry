/*
 * edition_sites（文章 × 站点）同步：凡写文章 {site_id} ∪ sites[] 的地方
 * （新建草稿、保存草稿、站点分配、复制、采纳稿源）都在同一事务内调它，
 * 保持 edition_sites 与最新版本行一致。
 * - 新增站点：插 pending 行（ON CONFLICT 幂等）；
 * - 移出的站点：只删 pending 行——published/failed/unpublished 行保留，
 *   撤下站点的 gone 语义由 A4 的 DELETE /sites/{siteId} 负责。
 */

import { and, eq, notInArray } from "drizzle-orm"

import type { ServerDb } from "../db/client"
import { editionSites } from "../db/edition-schema"

export type EditionSitesTx = Parameters<Parameters<ServerDb["transaction"]>[0]>[0]

export type SyncEditionSitesInput = Readonly<{
  readonly editionId: number
  readonly siteId: number | null
  readonly sites: readonly number[]
  readonly tenantId: number | null
}>

export const desiredEditionSiteIdsOf = (input: Pick<SyncEditionSitesInput, "siteId" | "sites">) => {
  const ids = new Set<number>()
  if (input.siteId !== null) ids.add(input.siteId)
  for (const id of input.sites) ids.add(id)
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
        ...(desired.length === 0
          ? []
          : [notInArray(editionSites.siteId, desired)]),
        eq(editionSites.publishState, "pending"),
      ),
    )
}
