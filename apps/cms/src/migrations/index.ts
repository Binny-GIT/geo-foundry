import * as migration_20260818_023834_task9_bootstrap from "./20260818_023834_task9_bootstrap"
import * as migration_20260818_113851_task10_tenants_users from "./20260818_113851_task10_tenants_users"
import * as migration_20260818_121725_task11_sites_domains from "./20260818_121725_task11_sites_domains"

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
]
