import { and, desc, eq, inArray, or } from "drizzle-orm"

import { markdownToBlocks } from "../../editor/block-markdown"
import { hashEditionContent } from "../../services/edition-input-hash"
import type { ServerDb } from "../db/client"
import { contentEditions, editionSites, editionVersions } from "../db/edition-schema"
import { qualityAssessments } from "../db/session-schema"
import { editionSiteMemberSql } from "./edition-sites"

const COMPILABLE_STATUSES = ["approved", "compiled", "published"] as const
const EDITING_STATUSES = ["draft", "generating", "review"] as const
type VersionState = typeof editionVersions.$inferSelect.workflowStatus
const isEditing = (status: VersionState) => EDITING_STATUSES.some((editing) => editing === status)

export const selectSnapshotVersion = (input: {
  readonly current: typeof editionVersions.$inferSelect
  readonly published: typeof editionVersions.$inferSelect | undefined
  readonly publishState: typeof editionSites.$inferSelect.publishState
  readonly releaseId: string | null
}): {
  readonly version: typeof editionVersions.$inferSelect
  readonly fallback: boolean
} | null => {
  if (COMPILABLE_STATUSES.some((status) => status === input.current.workflowStatus)) {
    return { fallback: false, version: input.current }
  }
  if (
    isEditing(input.current.workflowStatus) &&
    input.publishState === "published" &&
    input.releaseId !== null &&
    input.published !== undefined &&
    input.published.compiledRelease === input.releaseId &&
    (input.published.workflowStatus === "compiled" ||
      input.published.workflowStatus === "published")
  ) {
    return { fallback: true, version: input.published }
  }
  return null
}

export const latestSnapshotVersionsQuery = (db: ServerDb, siteId: number) =>
  db
    .select({
      editionId: contentEditions.id,
      publishState: editionSites.publishState,
      releaseId: editionSites.releaseId,
      version: editionVersions,
    })
    .from(contentEditions)
    .innerJoin(
      editionVersions,
      and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
    )
    .innerJoin(
      editionSites,
      and(eq(editionSites.editionId, contentEditions.id), eq(editionSites.siteId, siteId)),
    )
    .where(
      and(
        editionSiteMemberSql(siteId),
        or(
          inArray(editionVersions.workflowStatus, [...COMPILABLE_STATUSES]),
          and(
            eq(editionSites.publishState, "published"),
            inArray(editionVersions.workflowStatus, [...EDITING_STATUSES]),
          ),
        ),
      ),
    )
    .limit(500)

export const publishedSnapshotVersionsQuery = (
  db: ServerDb,
  input: { readonly editionIds: number[]; readonly siteId: number },
) =>
  db
    .selectDistinctOn([editionVersions.parentId], {
      editionId: editionSites.editionId,
      version: editionVersions,
    })
    .from(editionSites)
    .innerJoin(
      editionVersions,
      and(
        eq(editionVersions.parentId, editionSites.editionId),
        eq(editionVersions.compiledRelease, editionSites.releaseId),
      ),
    )
    .where(
      and(
        eq(editionSites.siteId, input.siteId),
        eq(editionSites.publishState, "published"),
        inArray(editionSites.editionId, input.editionIds),
        inArray(editionVersions.workflowStatus, ["compiled", "published"]),
      ),
    )
    .orderBy(editionVersions.parentId, desc(editionVersions.createdAt), desc(editionVersions.id))

export const readSnapshotVersions = async (db: ServerDb, siteId: number) => {
  const latest = await latestSnapshotVersionsQuery(db, siteId)
  const editionIds = latest
    .filter((row) => row.publishState === "published" && isEditing(row.version.workflowStatus))
    .map((row) => row.editionId)
  // 按本站已发布 release 找修订；全局最新 published 可能属于另一站。
  // compiled 历史行也可用：多站先编译后发布时，本站记录才是发布证明。
  const published =
    editionIds.length === 0 ? [] : await publishedSnapshotVersionsQuery(db, { editionIds, siteId })
  const publishedByEdition = new Map(published.map((row) => [row.editionId, row.version]))
  return latest.flatMap((row) => {
    const selected = selectSnapshotVersion({
      current: row.version,
      published: publishedByEdition.get(row.editionId),
      publishState: row.publishState,
      releaseId: row.releaseId,
    })
    return selected === null ? [] : [{ editionId: row.editionId, ...selected }]
  })
}

export const publishedAssessmentQuery = (
  db: ServerDb,
  input: { readonly editionId: number; readonly siteId: number; readonly inputHash: string },
) =>
  db
    .select({ inputHash: qualityAssessments.inputHash, state: qualityAssessments.state })
    .from(qualityAssessments)
    .where(
      and(
        eq(qualityAssessments.editionId, input.editionId),
        eq(qualityAssessments.siteId, input.siteId),
        eq(qualityAssessments.inputHash, input.inputHash),
      ),
    )
    .orderBy(desc(qualityAssessments.createdAt), desc(qualityAssessments.id))
    .limit(1)

export const snapshotContentHash = (
  version: Pick<
    typeof editionVersions.$inferSelect,
    "bodyMarkdown" | "primaryTopic" | "secondaryTopics" | "summary" | "title"
  >,
): string =>
  hashEditionContent({
    body: markdownToBlocks(version.bodyMarkdown ?? ""),
    primaryTopic: version.primaryTopic ?? "",
    secondaryTopics: version.secondaryTopics,
    summary: version.summary ?? "",
    title: version.title ?? "",
  })
