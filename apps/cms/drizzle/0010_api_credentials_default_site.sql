/* api_credentials 增加密钥默认站点：投稿不带 suggestedSiteId 时回落到
 * 这里（显式值始终优先）。签发时已校验站点属于本租户；表内不做物理
 * 外键，遵循「新增引用列一律逻辑关联」的既有惯例。
 */

ALTER TABLE "geo_foundry"."api_credentials"
  ADD COLUMN IF NOT EXISTS "default_site_id" integer;
