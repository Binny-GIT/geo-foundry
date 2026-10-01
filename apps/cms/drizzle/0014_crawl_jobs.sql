/* 枚举新值在本事务只声明，不作为 DML 值使用。 */
ALTER TYPE geo_foundry.enum_connectors_type ADD VALUE IF NOT EXISTS 'crawl';
ALTER TYPE geo_foundry.enum_intake_items_channel ADD VALUE IF NOT EXISTS 'crawl';

CREATE TYPE geo_foundry.enum_crawl_jobs_state AS ENUM ('dispatched', 'notified', 'ingesting', 'ingested', 'failed');
CREATE TABLE geo_foundry.crawl_jobs (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  connector_id integer NOT NULL,
  parent_intake_item_id integer NOT NULL UNIQUE,
  job_id varchar(64) UNIQUE,
  delivery_id uuid UNIQUE,
  state geo_foundry.enum_crawl_jobs_state NOT NULL DEFAULT 'dispatched',
  crawl_status varchar(32),
  attempts integer NOT NULL DEFAULT 0,
  last_error varchar(500),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  ingested_at timestamptz,
  acked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crawl_jobs_tenant_idx ON geo_foundry.crawl_jobs (tenant_id);
CREATE INDEX crawl_jobs_state_updated_idx ON geo_foundry.crawl_jobs (state, updated_at);
CREATE INDEX crawl_jobs_connector_idx ON geo_foundry.crawl_jobs (connector_id, state);
