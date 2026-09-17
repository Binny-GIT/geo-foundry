/* intake_items 增加投稿归属用户：gfa_ 密钥（机器投稿）时记密钥绑定的
 * 真人用户，采纳成文章后 owner 与「AI 采集」来源标注都从这一列派生。
 * Console 会话创建的条目保持 NULL（与既有行为一致）。
 * 不建外键：表带 Payload 时代物理 FK，新增引用列一律逻辑关联。
 */

ALTER TABLE "geo_foundry"."intake_items"
  ADD COLUMN IF NOT EXISTS "created_by_id" integer;
