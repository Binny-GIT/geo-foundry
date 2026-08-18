import * as migration_20260818_023834_task9_bootstrap from "./20260818_023834_task9_bootstrap"

export const migrations = [
  {
    up: migration_20260818_023834_task9_bootstrap.up,
    down: migration_20260818_023834_task9_bootstrap.down,
    name: "20260818_023834_task9_bootstrap",
  },
]
