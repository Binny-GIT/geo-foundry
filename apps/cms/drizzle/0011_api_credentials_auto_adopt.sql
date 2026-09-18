/* api_credentials 增加自动成稿开关：打开后该密钥的 webhook 直投在
 * 入口校验全部通过时直接生成工作台草稿（status=draft），跳过收件箱
 * 人工采纳；审核、审批、发布仍是人工。默认 false —— 收件箱隔离边界
 * 只对显式配置过的密钥放开。
 */

ALTER TABLE "geo_foundry"."api_credentials"
  ADD COLUMN IF NOT EXISTS "auto_adopt" boolean NOT NULL DEFAULT false;
