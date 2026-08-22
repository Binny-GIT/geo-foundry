import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const readText = (path) => readFile(new URL(path, root), "utf8")
const readJson = async (path) => JSON.parse(await readText(path))

test("Given public CI When its workflow is inspected Then it runs only non-secret verification", async () => {
  const workflow = await readText(".github/workflows/ci.yml")

  assert.match(workflow, /permissions:\n {2}contents: read/)
  assert.match(workflow, /cancel-in-progress: true/)
  assert.match(workflow, /name: Public non-secret verification/)
  assert.match(workflow, /pnpm install --frozen-lockfile/)
  assert.match(workflow, /pnpm ci:verify/)
  assert.match(workflow, /GEO_FOUNDRY_CI_BASE_SHA/)
  assert.match(workflow, /fetch-depth: 0/)
  assert.doesNotMatch(
    workflow.slice(workflow.indexOf("  public:"), workflow.indexOf("  shared-services:")),
    /secrets\.|shared:check|test:e2e|test:faults/,
  )
})

test("Given protected CI When its workflow is inspected Then it requires an explicit protected dispatch and bounded cleanup", async () => {
  const workflow = await readText(".github/workflows/ci.yml")
  const protectedJob = workflow.slice(workflow.indexOf("  shared-services:"))

  assert.match(protectedJob, /github\.event_name == 'workflow_dispatch'/)
  assert.match(protectedJob, /github\.ref_protected/)
  assert.match(protectedJob, /runs-on: \[self-hosted, geo-foundry-protected\]/)
  assert.match(protectedJob, /environment: protected-shared-services/)
  assert.match(protectedJob, /umask 077/)
  assert.match(protectedJob, /GEO_FOUNDRY_PG_USER_FILE/)
  assert.match(protectedJob, /GEO_FOUNDRY_REDIS_PASSWORD_FILE/)
  assert.match(protectedJob, /GEO_FOUNDRY_CMS_SECRET_FILE/)
  assert.match(protectedJob, /GEO_FOUNDRY_S3_SECRET_KEY_FILE/)
  assert.match(protectedJob, /if: always\(\)\n {8}run: pnpm shared:cleanup/)
  assert.match(protectedJob, /if: always\(\)\n {8}run: rm -rf/)
})

test("Given CI verification When its local entrypoint is inspected Then it forces non-secret gates and evidence verification", async () => {
  const [manifest, script] = await Promise.all([
    readJson("package.json"),
    readText("scripts/ci/verify.mjs"),
  ])

  assert.equal(manifest.scripts["ci:verify"], "node scripts/ci/verify.mjs")
  assert.match(script, /TURBO_REMOTE_CACHE: "0"/)
  assert.match(script, /scanTrackedFiles\(\)/)
  assert.match(script, /format-changed\.mjs/)
  assert.match(script, /lint-changed\.mjs/)
  assert.ok(script.includes('await run("pnpm", ["build:fresh"])'))
  assert.ok(
    script.indexOf('await run("pnpm", ["build:fresh"])') <
      script.indexOf('await run("pnpm", ["typecheck"])'),
  )
  assert.match(script, /test:faults:contracts/)
  assert.match(script, /test:determinism/)
  assert.match(script, /test\/rollback\.test\.ts/)
  assert.match(script, /test:harness/)
  assert.match(script, /evidence:verify/)
  assert.doesNotMatch(script, /test:e2e|test:faults"\]/)
  assert.match(manifest.scripts["test:faults"], /turbo run build --force/)
  assert.match(manifest.scripts["test:faults"], /--filter=@geo\/cms/)
  assert.match(manifest.scripts["test:faults"], /--filter=@geo\/worker/)
})

test("Given protected shared-service execution When the secure runner is inspected Then it only injects credentials from owner-only files", async () => {
  const [runner, contentService, worker] = await Promise.all([
    readText("scripts/shared-services/secure-run.mjs"),
    readText("apps/content-service/src/main.ts"),
    readText("apps/worker/src/main.ts"),
  ])

  assert.match(runner, /GEO_FOUNDRY_PG_USER_FILE/)
  assert.match(runner, /GEO_FOUNDRY_PG_PASSWORD_FILE/)
  assert.match(runner, /GEO_FOUNDRY_REDIS_PASSWORD_FILE/)
  assert.match(runner, /GEO_FOUNDRY_S3_ACCESS_KEY_FILE/)
  assert.match(runner, /metadata\.mode & 0o077/)
  assert.match(runner, /metadata\.uid !== process\.getuid\(\)/)
  assert.match(runner, /delete childEnvironment\[variable\]/)
  assert.match(contentService, /CONTENT_SERVICE_CREDENTIAL_FILE_INSECURE/)
  assert.match(contentService, /metadata\.mode & 0o077/)
  assert.match(worker, /WORKER_CREDENTIAL_FILE_INSECURE/)
  assert.match(worker, /metadata\.mode & 0o077/)
})
