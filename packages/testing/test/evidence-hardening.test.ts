import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  type EvidenceVerificationError,
  resolveEvidenceReceiptPath,
  verifyEvidence,
} from "../src/index.js"
import { evidenceManifestSchema } from "../src/evidence/model.js"
import { writeEvidenceReceipt } from "../src/evidence/receipt.js"
import { receiptPathFor, writeEvidenceFixture } from "./evidence-fixture.js"

const temporaryDirectories: string[] = []

const createFixture = async (
  name: string,
): Promise<{
  readonly evidenceDirectory: string
  readonly workspaceRoot: string
}> => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), `${name}-`))
  temporaryDirectories.push(workspaceRoot)
  const evidenceDirectory = join(workspaceRoot, ".omo", "evidence", "task-7")
  await mkdir(evidenceDirectory, { recursive: true })
  await writeEvidenceFixture({ evidenceDirectory, fresh: true })
  return Object.freeze({ evidenceDirectory, workspaceRoot })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("证据加固门禁", () => {
  it("在许可根内存在指向外部的符号链接时拒绝证据目录", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-symlink-workspace-"))
    const outsideDirectory = await mkdtemp(join(tmpdir(), "geo-foundry-symlink-outside-"))
    temporaryDirectories.push(workspaceRoot, outsideDirectory)
    const evidenceRoot = join(workspaceRoot, ".omo", "evidence")
    const evidenceDirectory = join(evidenceRoot, "task-7")
    await mkdir(evidenceRoot, { recursive: true })
    await symlink(outsideDirectory, evidenceDirectory)

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_PATH_SYMLINK",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在许可根内保留全新的嵌套证据目录", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-nested-workspace-"))
    temporaryDirectories.push(workspaceRoot)
    const evidenceDirectory = join(workspaceRoot, ".omo", "evidence", "task-7", "nested")
    await mkdir(evidenceDirectory, { recursive: true })

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_REPORT_MISSING",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在工作区根本身为符号链接时拒绝验证", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-real-workspace-"))
    const linkedWorkspaceRoot = `${workspaceRoot}-link`
    temporaryDirectories.push(workspaceRoot)
    await symlink(workspaceRoot, linkedWorkspaceRoot)
    const evidenceDirectory = join(linkedWorkspaceRoot, ".omo", "evidence", "task-7")

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot: linkedWorkspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_PATH_SYMLINK",
    } satisfies Partial<EvidenceVerificationError>)
    await unlink(linkedWorkspaceRoot)
  })

  it("在 receipt 标识包含路径遍历时拒绝解析", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-receipt-path-"))
    temporaryDirectories.push(workspaceRoot)

    // When
    const resolution = resolveEvidenceReceiptPath(workspaceRoot, "../outside")

    // Then
    await expect(resolution).rejects.toMatchObject({
      code: "EVIDENCE_RECEIPT_PATH_UNSAFE",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在测试报告执行种子与 provenance 不一致时拒绝证据", async () => {
    // Given
    const workspaceRoot = await mkdtemp(join(tmpdir(), "geo-foundry-report-seed-"))
    temporaryDirectories.push(workspaceRoot)
    const evidenceDirectory = join(workspaceRoot, ".omo", "evidence", "task-7")
    await mkdir(evidenceDirectory, { recursive: true })
    await writeEvidenceFixture({ evidenceDirectory, fresh: true, reportSeed: 123 })

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_TEST_SEED_MISMATCH",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在证据文件本身为指向外部的符号链接时拒绝验证", async () => {
    // Given
    const { evidenceDirectory, workspaceRoot } = await createFixture("geo-foundry-report-link")
    const reportPath = join(evidenceDirectory, "test-results.json")
    const reportContents = await readFile(reportPath, "utf8")
    const outsideDirectory = await mkdtemp(join(tmpdir(), "geo-foundry-report-outside-"))
    temporaryDirectories.push(outsideDirectory)
    const outsideReportPath = join(outsideDirectory, "test-results.json")
    await writeFile(outsideReportPath, reportContents, "utf8")
    await unlink(reportPath)
    await symlink(outsideReportPath, reportPath)

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_PATH_SYMLINK",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在报告与 manifest 同步重写但父级 receipt 未更新时拒绝证据", async () => {
    // Given
    const { evidenceDirectory, workspaceRoot } = await createFixture("geo-foundry-rewrite")
    const reportPath = join(evidenceDirectory, "test-results.json")
    const report = JSON.parse(await readFile(reportPath, "utf8"))
    report.auditRewrite = true
    const reportContents = `${JSON.stringify(report)}\n`
    await writeFile(reportPath, reportContents, "utf8")
    const manifestPath = join(evidenceDirectory, "evidence-manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    const record = manifest.reports.find(
      (candidate: { readonly path: string }) => candidate.path === "test-results.json",
    )
    record.sha256 = createHash("sha256").update(reportContents).digest("hex")
    record.generatedAt = new Date().toISOString()
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_RECEIPT_MANIFEST_MISMATCH",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在父级 receipt 被篡改时拒绝证据", async () => {
    // Given
    const { evidenceDirectory, workspaceRoot } = await createFixture("geo-foundry-receipt")
    const receiptPath = receiptPathFor(evidenceDirectory)
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
    receipt.provenanceSha256 = "b".repeat(64)
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8")

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_RECEIPT_PROVENANCE_MISMATCH",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在同一运行标识的父级 receipt 已存在时拒绝覆盖", async () => {
    // Given
    const { evidenceDirectory, workspaceRoot } = await createFixture("geo-foundry-receipt-once")
    const manifest = evidenceManifestSchema.parse(
      JSON.parse(await readFile(join(evidenceDirectory, "evidence-manifest.json"), "utf8")),
    )

    // When
    const rewrite = writeEvidenceReceipt({ evidenceDirectory, manifest, workspaceRoot })

    // Then
    await expect(rewrite).rejects.toMatchObject({
      code: "EVIDENCE_RECEIPT_EXISTS",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在 receipt 与 manifest 的运行标识不一致时拒绝证据", async () => {
    // Given
    const { evidenceDirectory, workspaceRoot } = await createFixture("geo-foundry-run-id")
    const receiptPath = receiptPathFor(evidenceDirectory)
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
    receipt.runIdentity.attempt = "other-attempt"
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8")

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_RECEIPT_RUN_ID_MISMATCH",
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在父级 receipt 缺失时拒绝证据", async () => {
    // Given
    const { evidenceDirectory, workspaceRoot } = await createFixture("geo-foundry-receipt-missing")
    const receiptPath = receiptPathFor(evidenceDirectory)
    await unlink(receiptPath)

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_RECEIPT_MISSING",
      paths: [join(".receipts", "task-7.json")],
    } satisfies Partial<EvidenceVerificationError>)
  })

  it("在 receipt 父目录为符号链接时拒绝验证", async () => {
    // Given
    const { evidenceDirectory, workspaceRoot } = await createFixture("geo-foundry-receipt-link")
    const receiptPath = receiptPathFor(evidenceDirectory)
    const receiptContents = await readFile(receiptPath, "utf8")
    const receiptsDirectory = dirname(receiptPath)
    const outsideDirectory = await mkdtemp(join(tmpdir(), "geo-foundry-receipt-outside-"))
    temporaryDirectories.push(outsideDirectory)
    await writeFile(join(outsideDirectory, "task-7.json"), receiptContents, "utf8")
    await rm(receiptsDirectory, { recursive: true })
    await symlink(outsideDirectory, receiptsDirectory)

    // When
    const verification = verifyEvidence({ evidenceDirectory, workspaceRoot })

    // Then
    await expect(verification).rejects.toMatchObject({
      code: "EVIDENCE_PATH_SYMLINK",
    } satisfies Partial<EvidenceVerificationError>)
  })
})
