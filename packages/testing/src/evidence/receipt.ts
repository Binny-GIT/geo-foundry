import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, relative, resolve } from "node:path"

import { EvidenceVerificationError } from "./errors.js"
import { readJson, sha256 } from "./files.js"
import {
  type EvidenceManifest,
  type EvidenceReceipt,
  evidenceReceiptSchema,
  provenanceSchema,
} from "./model.js"
import { resolveEvidenceReceiptPath } from "./path.js"

export type EvidenceReceiptOptions = {
  readonly evidenceDirectory: string
  readonly manifest: EvidenceManifest
  readonly workspaceRoot: string
}

const isExistingPathError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "EEXIST"

const receiptRelativePath = (workspaceRoot: string, receiptPath: string): string =>
  relative(resolve(workspaceRoot, ".omo", "evidence"), receiptPath)

export const writeEvidenceReceipt = async (options: EvidenceReceiptOptions): Promise<void> => {
  const attempt = basename(options.evidenceDirectory)
  const receiptPath = await resolveEvidenceReceiptPath(options.workspaceRoot, attempt)
  await mkdir(dirname(receiptPath), { recursive: true })
  const checkedReceiptPath = await resolveEvidenceReceiptPath(options.workspaceRoot, attempt)
  const [manifestContents, provenanceContents] = await Promise.all([
    readFile(`${options.evidenceDirectory}/evidence-manifest.json`),
    readFile(`${options.evidenceDirectory}/provenance.json`),
  ])
  const receipt = Object.freeze({
    canonicalManifestSha256: sha256(manifestContents),
    createdAt: new Date().toISOString(),
    provenanceSha256: sha256(provenanceContents),
    runIdentity: Object.freeze({
      attempt: options.manifest.attempt,
      seed: options.manifest.seed,
      startedAt: options.manifest.startedAt,
    }),
    version: 1,
  } satisfies EvidenceReceipt)
  try {
    await writeFile(checkedReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o400,
    })
  } catch (error) {
    if (isExistingPathError(error)) {
      throw new EvidenceVerificationError("EVIDENCE_RECEIPT_EXISTS", [
        receiptRelativePath(options.workspaceRoot, checkedReceiptPath),
      ])
    }
    throw error
  }
}

export const verifyEvidenceReceipt = async (options: EvidenceReceiptOptions): Promise<void> => {
  const attempt = basename(options.evidenceDirectory)
  const receiptPath = await resolveEvidenceReceiptPath(options.workspaceRoot, attempt)
  let receiptInput: unknown
  try {
    receiptInput = await readJson(receiptPath)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new EvidenceVerificationError("EVIDENCE_RECEIPT_MISSING", [
        receiptRelativePath(options.workspaceRoot, receiptPath),
      ])
    }
    throw error
  }
  const receipt = evidenceReceiptSchema.safeParse(receiptInput)
  if (!receipt.success) {
    throw new EvidenceVerificationError("EVIDENCE_RECEIPT_INVALID", [
      receiptRelativePath(options.workspaceRoot, receiptPath),
    ])
  }
  const [manifestContents, provenanceContents, provenanceInput] = await Promise.all([
    readFile(`${options.evidenceDirectory}/evidence-manifest.json`),
    readFile(`${options.evidenceDirectory}/provenance.json`),
    readJson(`${options.evidenceDirectory}/provenance.json`),
  ])
  if (sha256(manifestContents) !== receipt.data.canonicalManifestSha256) {
    throw new EvidenceVerificationError("EVIDENCE_RECEIPT_MANIFEST_MISMATCH", [
      "evidence-manifest.json",
    ])
  }
  if (sha256(provenanceContents) !== receipt.data.provenanceSha256) {
    throw new EvidenceVerificationError("EVIDENCE_RECEIPT_PROVENANCE_MISMATCH", ["provenance.json"])
  }
  const provenance = provenanceSchema.safeParse(provenanceInput)
  const identity = receipt.data.runIdentity
  if (
    !provenance.success ||
    identity.attempt !== options.manifest.attempt ||
    identity.seed !== options.manifest.seed ||
    identity.startedAt !== options.manifest.startedAt ||
    provenance.data.seed !== identity.seed
  ) {
    throw new EvidenceVerificationError("EVIDENCE_RECEIPT_RUN_ID_MISMATCH", [
      receiptRelativePath(options.workspaceRoot, receiptPath),
    ])
  }
}
