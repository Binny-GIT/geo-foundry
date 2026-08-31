import * as migration_20260818_023834_task9_bootstrap from "./20260818_023834_task9_bootstrap"
import * as migration_20260818_113851_task10_tenants_users from "./20260818_113851_task10_tenants_users"
import * as migration_20260818_121725_task11_sites_domains from "./20260818_121725_task11_sites_domains"
import * as migration_20260818_123425_task12_contents_editions from "./20260818_123425_task12_contents_editions"
import * as migration_20260818_125941_task13_media from "./20260818_125941_task13_media"
import * as migration_20260818_132154_task13b_media_path from "./20260818_132154_task13b_media_path"
import * as migration_20260818_135403_task14_url_records from "./20260818_135403_task14_url_records"
import * as migration_20260818_142113_task15_workflow from "./20260818_142113_task15_workflow"
import * as migration_20260818_162613_task16_outbox from "./20260818_162613_task16_outbox"
import * as migration_20260818_221655_task17_operations from "./20260818_221655_task17_operations"
import * as migration_20260818_221848_task17b_op_keyhash from "./20260818_221848_task17b_op_keyhash"
import * as migration_20260819_092000_task20_embeddings from "./20260819_092000_task20_embeddings"
import * as migration_20260819_153000_task24_request_payload from "./20260819_153000_task24_request_payload"
import * as migration_20260820_090000_task30_releases from "./20260820_090000_task30_releases"
import * as migration_20260822_093000_content_modified_at from "./20260822_093000_content_modified_at"
import * as migration_20260826_074307_reviewer_edition_decisions from "./20260826_074307_reviewer_edition_decisions"
import * as migration_20260826_100744_edition_draft_restore from "./20260826_100744_edition_draft_restore"
import * as migration_20260827_120000_wave3_intake_foundation from "./20260827_120000_wave3_intake_foundation"
import * as migration_20260827_130000_wave4_editorial_collaboration from "./20260827_130000_wave4_editorial_collaboration"
import * as migration_20260827_140000_wave5_publication_plans from "./20260827_140000_wave5_publication_plans"
import * as migration_20260827_150000_wave7_performance_snapshots from "./20260827_150000_wave7_performance_snapshots"
import * as migration_20260828_010000_wave8_rss_polling from "./20260828_010000_wave8_rss_polling"
import * as migration_20260830_100000_editor_evaluation_outbox from "./20260830_100000_editor_evaluation_outbox"
import * as migration_20260830_110000_rollback_outbox_dispatch from "./20260830_110000_rollback_outbox_dispatch"
import * as migration_20260831_230000_user_site_scope from "./20260831_230000_user_site_scope"
import * as migration_20260901_000000_api_usage_daily from "./20260901_000000_api_usage_daily"

export const migrations = [
  {
    up: migration_20260818_023834_task9_bootstrap.up,
    down: migration_20260818_023834_task9_bootstrap.down,
    name: "20260818_023834_task9_bootstrap",
  },
  {
    up: migration_20260818_113851_task10_tenants_users.up,
    down: migration_20260818_113851_task10_tenants_users.down,
    name: "20260818_113851_task10_tenants_users",
  },
  {
    up: migration_20260818_121725_task11_sites_domains.up,
    down: migration_20260818_121725_task11_sites_domains.down,
    name: "20260818_121725_task11_sites_domains",
  },
  {
    up: migration_20260818_123425_task12_contents_editions.up,
    down: migration_20260818_123425_task12_contents_editions.down,
    name: "20260818_123425_task12_contents_editions",
  },
  {
    up: migration_20260818_125941_task13_media.up,
    down: migration_20260818_125941_task13_media.down,
    name: "20260818_125941_task13_media",
  },
  {
    up: migration_20260818_132154_task13b_media_path.up,
    down: migration_20260818_132154_task13b_media_path.down,
    name: "20260818_132154_task13b_media_path",
  },
  {
    up: migration_20260818_135403_task14_url_records.up,
    down: migration_20260818_135403_task14_url_records.down,
    name: "20260818_135403_task14_url_records",
  },
  {
    up: migration_20260818_142113_task15_workflow.up,
    down: migration_20260818_142113_task15_workflow.down,
    name: "20260818_142113_task15_workflow",
  },
  {
    up: migration_20260818_162613_task16_outbox.up,
    down: migration_20260818_162613_task16_outbox.down,
    name: "20260818_162613_task16_outbox",
  },
  {
    up: migration_20260818_221655_task17_operations.up,
    down: migration_20260818_221655_task17_operations.down,
    name: "20260818_221655_task17_operations",
  },
  {
    up: migration_20260818_221848_task17b_op_keyhash.up,
    down: migration_20260818_221848_task17b_op_keyhash.down,
    name: "20260818_221848_task17b_op_keyhash",
  },
  {
    up: migration_20260819_092000_task20_embeddings.up,
    down: migration_20260819_092000_task20_embeddings.down,
    name: "20260819_092000_task20_embeddings",
  },
  {
    up: migration_20260819_153000_task24_request_payload.up,
    down: migration_20260819_153000_task24_request_payload.down,
    name: "20260819_153000_task24_request_payload",
  },
  {
    up: migration_20260820_090000_task30_releases.up,
    down: migration_20260820_090000_task30_releases.down,
    name: "20260820_090000_task30_releases",
  },
  {
    up: migration_20260822_093000_content_modified_at.up,
    down: migration_20260822_093000_content_modified_at.down,
    name: "20260822_093000_content_modified_at",
  },
  {
    up: migration_20260826_074307_reviewer_edition_decisions.up,
    down: migration_20260826_074307_reviewer_edition_decisions.down,
    name: "20260826_074307_reviewer_edition_decisions",
  },
  {
    up: migration_20260826_100744_edition_draft_restore.up,
    down: migration_20260826_100744_edition_draft_restore.down,
    name: "20260826_100744_edition_draft_restore",
  },
  {
    up: migration_20260827_120000_wave3_intake_foundation.up,
    down: migration_20260827_120000_wave3_intake_foundation.down,
    name: "20260827_120000_wave3_intake_foundation",
  },
  {
    up: migration_20260827_130000_wave4_editorial_collaboration.up,
    down: migration_20260827_130000_wave4_editorial_collaboration.down,
    name: "20260827_130000_wave4_editorial_collaboration",
  },
  {
    up: migration_20260827_140000_wave5_publication_plans.up,
    down: migration_20260827_140000_wave5_publication_plans.down,
    name: "20260827_140000_wave5_publication_plans",
  },
  {
    up: migration_20260827_150000_wave7_performance_snapshots.up,
    down: migration_20260827_150000_wave7_performance_snapshots.down,
    name: "20260827_150000_wave7_performance_snapshots",
  },
  {
    up: migration_20260828_010000_wave8_rss_polling.up,
    down: migration_20260828_010000_wave8_rss_polling.down,
    name: "20260828_010000_wave8_rss_polling",
  },
  {
    up: migration_20260830_100000_editor_evaluation_outbox.up,
    down: migration_20260830_100000_editor_evaluation_outbox.down,
    name: "20260830_100000_editor_evaluation_outbox",
  },
  {
    up: migration_20260830_110000_rollback_outbox_dispatch.up,
    down: migration_20260830_110000_rollback_outbox_dispatch.down,
    name: "20260830_110000_rollback_outbox_dispatch",
  },
  {
    up: migration_20260831_230000_user_site_scope.up,
    down: migration_20260831_230000_user_site_scope.down,
    name: "20260831_230000_user_site_scope",
  },
  {
    up: migration_20260901_000000_api_usage_daily.up,
    down: migration_20260901_000000_api_usage_daily.down,
    name: "20260901_000000_api_usage_daily",
  },
]
