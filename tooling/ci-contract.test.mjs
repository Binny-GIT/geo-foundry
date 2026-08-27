import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const readText = async (path) => (await readFile(new URL(path, root), "utf8")).replaceAll("\r\n", "\n")
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

test("Given CI verification When its local entrypoint is inspected Then it forces non-secret direct gates", async () => {
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
  assert.doesNotMatch(
    script,
    /packages:validate|packages:pack-smoke|task-6-packed-consumer|package-validate\.mjs|package-smoke\.mjs/,
  )
  assert.doesNotMatch(script, /test:e2e|test:faults"\]|test:harness|evidence:verify|evidence-manifest/)
  assert.match(manifest.scripts["test:faults"], /turbo run build --force/)
  assert.match(manifest.scripts["test:faults"], /--filter=@geo\/cms/)
  assert.match(manifest.scripts["test:faults"], /--filter=@geo\/worker/)
})

test("Given container deployment When Compose is inspected Then credentials are FILE-only read-only mounts", async () => {
  const [compose, mkDev, verify, smoke] = await Promise.all([
    readText("deploy/compose.yaml"),
    readText("deploy/compose.mk-dev.yaml"),
    readText("deploy/smoke/verify.env"),
    readText("deploy/smoke/prepare-verify-credentials.sh"),
  ])

  for (const directVariable of [
    "GEO_FOUNDRY_PG_USER:",
    "GEO_FOUNDRY_PG_PASSWORD:",
    "GEO_FOUNDRY_S3_ACCESS_KEY:",
    "GEO_FOUNDRY_S3_SECRET_KEY:",
    "PAYLOAD_SECRET:",
    "CONTENT_SERVICE_API_KEY:",
    "GEO_FOUNDRY_REDIS_PASSWORD:",
  ]) {
    assert.doesNotMatch(compose, new RegExp(`\\n\\s+${directVariable}`))
  }
  assert.match(compose, /GEO_FOUNDRY_CREDENTIAL_MODE: file/)
  assert.match(compose, /GEO_FOUNDRY_CREDENTIALS_DIR/)
  assert.match(compose, /read_only: true/)
  assert.match(compose, /CONTENT_SERVICE_KEYRING_FILE/)
  assert.match(compose, /GEO_FOUNDRY_CMS_SECRET_FILE/)
  assert.match(mkDev, /profiles: !override \[\]/)
  assert.doesNotMatch(verify, /placeholder|PASSWORD=|SECRET=|KEY=/)
  assert.match(smoke, /-o 1001 -g 1001/)
  assert.match(smoke, /chmod 600/)
})

test("Given protected shared-service execution When the secure runner is inspected Then it only injects credentials from owner-only files", async () => {
  const [runner, worker, credentials, operations, workflow] = await Promise.all([
    readText("scripts/shared-services/secure-run.mjs"),
    readText("apps/worker/src/main.ts"),
    readText("apps/worker/src/config/credentials.ts"),
    readText("apps/cms/src/endpoints/internal/operations.ts"),
    readText("apps/cms/src/endpoints/edition-workflow.ts"),
  ])

  assert.match(runner, /GEO_FOUNDRY_PG_USER_FILE/)
  assert.match(runner, /GEO_FOUNDRY_PG_PASSWORD_FILE/)
  assert.match(runner, /GEO_FOUNDRY_REDIS_PASSWORD_FILE/)
  assert.match(runner, /GEO_FOUNDRY_S3_ACCESS_KEY_FILE/)
  assert.match(runner, /metadata\.mode & 0o077/)
  assert.match(runner, /metadata\.uid !== process\.getuid\(\)/)
  assert.match(runner, /delete childEnvironment\[variable\]/)
  assert.match(worker, /workerCredentialOf/)
  assert.match(credentials, /WORKER_CREDENTIAL_FILE_INSECURE/)
  assert.match(credentials, /metadata\.mode & 0o077/)
  assert.match(worker, /CMS_BASE_URL/)
  assert.match(workflow, /\/editions\/:id\/publish-operations/)
  assert.match(operations, /publisher identity must submit publish operations/)
  assert.doesNotMatch(operations, /\/internal\/operations\/publish|\/v1\/publish/)
})
