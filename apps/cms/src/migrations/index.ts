import * as migration_20260818_023834_task9_bootstrap from "./20260818_023834_task9_bootstrap"
import * as migration_20260818_113851_task10_tenants_users from "./20260818_113851_task10_tenants_users"
import * as migration_20260818_121725_task11_sites_domains from "./20260818_121725_task11_sites_domains"
import * as migration_20260818_123425_task12_contents_editions from "./20260818_123425_task12_contents_editions"
import * as migration_20260818_125941_task13_media from "./20260818_125941_task13_media"
import * as migration_20260818_132154_task13b_media_path from "./20260818_132154_task13b_media_path"
import * as migration_20260818_135403_task14_url_records from "./20260818_135403_task14_url_records"
import * as migration_20260818_142113_task15_workflow from "./20260818_142113_task15_workflow"

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
]
