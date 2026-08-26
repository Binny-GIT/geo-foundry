import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const readText = (path) => readFile(new URL(path, root), "utf8")

const documents = [
  "README.md",
  "docs/package-integration.md",
  "docs/ux/admin-operations-ux-spec.md",
  "docs/adr/001-control-plane-serving-plane.md",
  "docs/adr/002-page-document-versioning.md",
  "docs/adr/003-tenancy-no-existence-leak.md",
  "docs/adr/004-quality-thresholds-fail-closed.md",
  "docs/adr/005-immutable-release-cas-rollback.md",
  "docs/runbooks/README.md",
  "docs/runbooks/shared-services.md",
  "docs/runbooks/migrations.md",
  "docs/runbooks/publish.md",
  "docs/runbooks/rollback.md",
  "docs/runbooks/reconciliation.md",
  "docs/runbooks/evidence.md",
  "docs/runbooks/incidents.md",
]

test("Given Todo 40 documentation When checked Then architecture, package, and operator guides are present", async () => {
  const contents = await Promise.all(documents.map(readText))

  assert.equal(
    contents.every((content) => content.length > 100),
    true,
  )
  const readme = contents[0] ?? ""
  assert.match(readme, /pnpm ci:verify/)
  assert.match(readme, /mydocs\/260817-geo-foundry-PRD\.md/)
  assert.match(readme, /owner-only/)
  assert.match(readme, /docs\/ux\/admin-operations-ux-spec\.md/)
  const adminOperationsUx = contents[2] ?? ""
  assert.match(adminOperationsUx, /运营指挥台/)
  assert.match(adminOperationsUx, /overrideAccess=false/)
  assert.match(adminOperationsUx, /不得调用 `\/api\/internal\/\*`/)
})

test("Given operator runbooks When inspected Then they route sensitive actions through bounded approved commands", async () => {
  const [sharedServices, migrations, evidence, incidents] = await Promise.all([
    readText("docs/runbooks/shared-services.md"),
    readText("docs/runbooks/migrations.md"),
    readText("docs/runbooks/evidence.md"),
    readText("docs/runbooks/incidents.md"),
  ])

  assert.match(sharedServices, /pnpm shared:check/)
  assert.match(sharedServices, /pnpm shared:cleanup/)
  assert.match(sharedServices, /FLUSHDB/)
  assert.match(migrations, /db:migrate/)
  assert.match(evidence, /pnpm evidence:verify/)
  assert.match(incidents, /不要/)
  assert.doesNotMatch(sharedServices + migrations + evidence + incidents, /AKIA[A-Z0-9]{16}/)
})
