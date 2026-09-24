/* B3 发布事件 + canonical 台账修正：
 * 1. sites 加 webhook_url / webhook_secret_reference（出站 webhook 配置；
 *    密钥引用名指向 GEO_FOUNDRY_CREDENTIALS_DIR 下的具名文件，
 *    与 connectors.secret_reference 同一惯例，仅存引用名不存密钥）；
 * 2. site_event_deliveries：发布事件投递台账，兼作死信落点
 *    （worker 重试耗尽后 state='failed'，可查询、可重放依据）；
 * 3. canonical_url 存量修正：旧值形状为 https://<域名>/<locale><路径>
 *    （domain 包 constructCanonicalUrl 曾强加 locale 前缀），而页面实际
 *    输出恒为 https://<域名><路径>（编译器 canonicalUrlOf，无 locale）。
 *    台账向编译器形状收敛。只更新能由本行 locale+pathname 精确重构出旧值
 *    的行（幂等，重复执行不破坏已修正值）。
 */

ALTER TABLE geo_foundry.sites
  ADD COLUMN IF NOT EXISTS webhook_url varchar(2048),
  ADD COLUMN IF NOT EXISTS webhook_secret_reference varchar(128);

CREATE TYPE geo_foundry.enum_site_event_types AS ENUM ('published', 'updated', 'unpublished');
CREATE TYPE geo_foundry.enum_site_event_deliveries_state AS ENUM ('delivered', 'failed');

CREATE TABLE IF NOT EXISTS geo_foundry.site_event_deliveries (
  id serial PRIMARY KEY,
  event_id varchar(64) NOT NULL,
  tenant_id integer NOT NULL,
  site_id integer NOT NULL,
  event_type geo_foundry.enum_site_event_types NOT NULL,
  hostname varchar(253),
  release_id varchar(64),
  webhook_url varchar(2048) NOT NULL,
  state geo_foundry.enum_site_event_deliveries_state NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_status_code integer,
  last_error varchar(500),
  created_at timestamp(3) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(3) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_event_deliveries_event_unique UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS site_event_deliveries_site_idx
  ON geo_foundry.site_event_deliveries (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_event_deliveries_tenant_idx
  ON geo_foundry.site_event_deliveries (tenant_id);

UPDATE geo_foundry.url_records ur
SET canonical_url = 'https://' || split_part(ur.canonical_url, '/', 3) || ur.pathname
WHERE ur.canonical_url IS NOT NULL
  AND ur.canonical_url = 'https://' || split_part(ur.canonical_url, '/', 3) || '/' || ur.locale || ur.pathname;
