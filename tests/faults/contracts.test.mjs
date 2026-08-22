import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  assertFaultRunId,
  createFaultRunId,
  faultCase,
  faultEvidenceDirectoryOf,
  ownedPhysicalKey,
  secureFile,
} from "./support.mjs"

const workspaceRoot = "/home/ubuntu/project/Binny-GIT/geo-foundry"

const withEnvironment = async (name, value, work) => {
  const previous = process.env[name]
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
  try {
    return await work()
  } finally {
    if (previous === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = previous
    }
  }
}

test("Todo 39 creates an owned fault namespace", () => {
  const runId = createFaultRunId()
  assert.match(runId, /^todo39-[a-z0-9]{20}$/)
  assert.equal(assertFaultRunId(runId), runId)
  assert.throws(() => assertFaultRunId("e2e-not-owned"), /FAULT_RUN_ID_INVALID/)
  assert.equal(
    ownedPhysicalKey(`objects/todo39/${runId}`, "sites/site-a/channels/current.json"),
    `objects/todo39/${runId}/sites/site-a/channels/current.json`,
  )
  assert.throws(
    () => ownedPhysicalKey(`objects/todo39/${runId}`, "../routing/channels/current.json"),
    /FAULT_LOGICAL_KEY_FORBIDDEN/,
  )
})

test("Todo 39 rejects repository and ZCode evidence directories", async () => {
  await withEnvironment("GEO_FOUNDRY_FAULT_EVIDENCE_DIR", workspaceRoot, async () => {
    await assert.rejects(
      () => faultEvidenceDirectoryOf(workspaceRoot),
      /FAULT_EVIDENCE_DIRECTORY_FORBIDDEN/,
    )
  })
  await withEnvironment(
    "GEO_FOUNDRY_FAULT_EVIDENCE_DIR",
    join(workspaceRoot, ".zcode", "evidence"),
    async () => {
      await assert.rejects(
        () => faultEvidenceDirectoryOf(workspaceRoot),
        /FAULT_EVIDENCE_DIRECTORY_FORBIDDEN/,
      )
    },
  )
})

test("Todo 39 only accepts owner-only credential file references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "geo-foundry-fault-contract-"))
  const path = join(directory, "credential")
  try {
    await writeFile(path, "test-value\n", { mode: 0o600 })
    await withEnvironment("GEO_FOUNDRY_FAULT_TEST_FILE", path, async () => {
      assert.deepEqual(await secureFile("GEO_FOUNDRY_FAULT_TEST_FILE"), {
        path,
        value: "test-value",
      })
    })
    await chmod(path, 0o644)
    await withEnvironment("GEO_FOUNDRY_FAULT_TEST_FILE", path, async () => {
      await assert.rejects(
        () => secureFile("GEO_FOUNDRY_FAULT_TEST_FILE"),
        /FAULT_CREDENTIAL_FILE_INSECURE/,
      )
    })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("Todo 39 fault evidence records require a terminal recovered status", () => {
  const record = faultCase({
    assertions: ["runtime returned 503", "recovery returned 200"],
    fault: "artifact-tamper",
    id: "serving-artifact-tamper",
    recovery: "restored immutable page bytes and refreshed the owned pointer",
    status: "recovered",
  })
  assert.deepEqual(record.assertions, ["runtime returned 503", "recovery returned 200"])
  assert.throws(
    () =>
      faultCase({
        assertions: [],
        fault: "invalid",
        id: "invalid",
        recovery: "none",
        status: "running",
      }),
    /FAULT_CASE_STATUS_INVALID/,
  )
})
