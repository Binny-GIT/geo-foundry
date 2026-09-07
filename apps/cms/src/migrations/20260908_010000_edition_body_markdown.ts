import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export const up = async ({ payload }: MigrateUpArgs): Promise<void> => {
  /* bodyMarkdown 是正文的唯一编辑真相；body 区块保留为派生数据供编译/发布链路。 */
  await payload.db.drizzle.execute(
    sql`ALTER TABLE "geo_foundry"."content_editions" ADD COLUMN IF NOT EXISTS "body_markdown" text`,
  )
  await payload.db.drizzle.execute(
    sql`ALTER TABLE "geo_foundry"."_content_editions_v" ADD COLUMN IF NOT EXISTS "version_body_markdown" text`,
  )
}

export const down = async ({ payload }: MigrateDownArgs): Promise<void> => {
  await payload.db.drizzle.execute(
    sql`ALTER TABLE "geo_foundry"."content_editions" DROP COLUMN IF EXISTS "body_markdown"`,
  )
  await payload.db.drizzle.execute(
    sql`ALTER TABLE "geo_foundry"."_content_editions_v" DROP COLUMN IF EXISTS "version_body_markdown"`,
  )
}
