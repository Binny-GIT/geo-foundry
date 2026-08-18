import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { buildProvenance, type EvidenceVerificationError, verifyEvidence } from "../src/index.js"
import { writeEvidenceFixture } from "./evidence-fixture.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("证据门禁", () => {
  it("在必需报告缺失时列出确定的相对路径", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-evidence-"))
    temporaryDirectories.push(workspaceRoot)
    const evidenceDirectory = join(workspaceRoot, ".omo", "evidence", "task-7")
    await mkdir(evidenceDirectory, { recursive: true })

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_REPORT_MISSING",
      paths: [
        "commands.json",
        "coverage/coverage-summary.json",
        "evidence-manifest.json",
        "integration-results.json",
        "integration.junit.xml",
        "intentional-failure.json",
        "intentional-failure.junit.xml",
        "junit.xml",
        "logs/integration.stdout.log",
        "logs/intentional-failure.stdout.log",
        "logs/unit.stdout.log",
        "provenance.json",
        "task-7-geo-foundry-development-plan.json",
        "test-results.json",
      ],
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在执行元数据表明仅来自缓存时拒绝全部报告", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-cache-evidence-"))
    temporaryDirectories.push(workspaceRoot)
    const evidenceDirectory = join(workspaceRoot, ".omo", "evidence", "task-7")
    await mkdir(evidenceDirectory, { recursive: true })
    await writeEvidenceFixture({ evidenceDirectory, fresh: false })

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_CACHE_ONLY",
      paths: ["evidence-manifest.json"],
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在报告早于本次执行开始时间时拒绝陈旧证据", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-stale-evidence-"))
    temporaryDirectories.push(workspaceRoot)
    const evidenceDirectory = join(workspaceRoot, ".omo", "evidence", "task-7")
    await mkdir(evidenceDirectory, { recursive: true })
    await writeEvidenceFixture({
      evidenceDirectory,
      fresh: true,
      stalePath: "test-results.json",
    })

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_REPORT_STALE",
      paths: ["test-results.json"],
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在报告内容与 manifest 哈希不一致时拒绝证据", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-hash-evidence-"))
    temporaryDirectories.push(workspaceRoot)
    const evidenceDirectory = join(workspaceRoot, ".omo", "evidence", "task-7")
    await mkdir(evidenceDirectory, { recursive: true })
    await writeEvidenceFixture({ evidenceDirectory, fresh: true })
    await writeFile(
      join(evidenceDirectory, "test-results.json"),
      '{"numFailedTests":0,"tampered":true}\n',
      "utf8",
    )

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_REPORT_HASH_MISMATCH",
      paths: ["test-results.json"],
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在输入固定来源信息时产生完整且不可变的 provenance", () => {
    // Given
    const input = {
      clockInstant: "2026-08-18T00:00:00.000Z",
      fresh: true,
      gitHead: { kind: "unborn" },
      gitStatus: ["?? package.json"],
      locale: "en-US",
      lockfileSha256: "a".repeat(64),
      nodeVersion: "24.18.0",
      pnpmVersion: "11.22.0",
      recordedAt: "2026-08-17T12:00:00.000Z",
      seed: 260_817,
      timezone: "UTC",
      vitestCacheDirectory: ".vitest-cache",
    } as const

    // When
    const provenance = buildProvenance(input)

    // Then
    expect(provenance).toEqual({
      ...input,
      cacheSource: "none",
      gitDirty: true,
      gitSha: null,
    })
    expect(Object.isFrozen(provenance)).toBe(true)
    expect(Object.isFrozen(provenance.gitStatus)).toBe(true)
  })

  it("在输出目录逃离工作区时拒绝路径遍历", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-path-evidence-"))
    temporaryDirectories.push(workspaceRoot)
    const evidenceDirectory = join(workspaceRoot, "..", "outside-evidence")

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_PATH_OUTSIDE_WORKSPACE",
    } satisfies Partial<EvidenceVerificationError>)
  })
})
