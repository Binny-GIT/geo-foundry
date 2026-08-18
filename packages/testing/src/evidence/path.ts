import { lstat, realpath } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

import { EvidenceVerificationError } from "./errors.js"

export type EvidenceDirectoryOptions = {
  readonly requestedDirectory: string
  readonly workspaceRoot: string
}

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

const assertInside = (parent: string, child: string, code: string): string => {
  const parentRelative = relative(parent, child)
  if (
    parentRelative.length === 0 ||
    parentRelative.startsWith(`..${sep}`) ||
    parentRelative === ".." ||
    isAbsolute(parentRelative)
  ) {
    throw new EvidenceVerificationError(code, [parentRelative])
  }
  return parentRelative
}

const canonicalWorkspaceRoot = async (workspaceRoot: string): Promise<string> => {
  const lexicalRoot = resolve(workspaceRoot)
  const metadata = await lstat(lexicalRoot)
  if (metadata.isSymbolicLink()) {
    throw new EvidenceVerificationError("EVIDENCE_PATH_SYMLINK", [lexicalRoot])
  }
  const canonicalRoot = await realpath(lexicalRoot)
  if (canonicalRoot !== lexicalRoot) {
    throw new EvidenceVerificationError("EVIDENCE_WORKSPACE_NOT_CANONICAL", [lexicalRoot])
  }
  return canonicalRoot
}

const assertExistingHierarchy = async (
  workspaceRoot: string,
  targetPath: string,
): Promise<void> => {
  const workspaceRelative = relative(workspaceRoot, targetPath)
  let currentPath = workspaceRoot
  for (const segment of workspaceRelative.split(sep)) {
    currentPath = resolve(currentPath, segment)
    try {
      const metadata = await lstat(currentPath)
      if (metadata.isSymbolicLink()) {
        throw new EvidenceVerificationError("EVIDENCE_PATH_SYMLINK", [workspaceRelative])
      }
      const canonicalPath = await realpath(currentPath)
      assertInside(workspaceRoot, canonicalPath, "EVIDENCE_PATH_OUTSIDE_WORKSPACE")
    } catch (error) {
      if (isMissingPathError(error)) {
        return
      }
      throw error
    }
  }
}

const resolveSafeEvidencePath = async (
  workspaceRoot: string,
  requestedPath: string,
): Promise<{ readonly absolutePath: string; readonly workspaceRelative: string }> => {
  const canonicalRoot = await canonicalWorkspaceRoot(workspaceRoot)
  const absolutePath = resolve(canonicalRoot, requestedPath)
  const workspaceRelative = assertInside(
    canonicalRoot,
    absolutePath,
    "EVIDENCE_PATH_OUTSIDE_WORKSPACE",
  )
  await assertExistingHierarchy(canonicalRoot, absolutePath)
  return Object.freeze({ absolutePath, workspaceRelative })
}

export const resolveEvidenceDirectory = async (
  options: EvidenceDirectoryOptions,
): Promise<string> => {
  const resolved = await resolveSafeEvidencePath(options.workspaceRoot, options.requestedDirectory)
  const segments = resolved.workspaceRelative.split(sep)
  if (
    segments[0] !== ".omo" ||
    segments[1] !== "evidence" ||
    segments.length < 3 ||
    segments[2]?.startsWith(".")
  ) {
    throw new EvidenceVerificationError("EVIDENCE_PATH_UNSAFE", [resolved.workspaceRelative])
  }
  return resolved.absolutePath
}

export const resolveEvidenceReceiptPath = async (
  workspaceRoot: string,
  attempt: string,
): Promise<string> => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(attempt)) {
    throw new EvidenceVerificationError("EVIDENCE_RECEIPT_PATH_UNSAFE", [attempt])
  }
  const requestedPath = join(".omo", "evidence", ".receipts", `${attempt}.json`)
  const resolved = await resolveSafeEvidencePath(workspaceRoot, requestedPath)
  const expectedRelative = [".omo", "evidence", ".receipts", `${attempt}.json`].join(sep)
  if (resolved.workspaceRelative !== expectedRelative) {
    throw new EvidenceVerificationError("EVIDENCE_RECEIPT_PATH_UNSAFE", [attempt])
  }
  return resolved.absolutePath
}

export const resolveEvidenceArtifactPath = async (
  evidenceDirectory: string,
  artifactPath: string,
): Promise<string> => {
  const absolutePath = resolve(evidenceDirectory, artifactPath)
  assertInside(evidenceDirectory, absolutePath, "EVIDENCE_ARTIFACT_PATH_UNSAFE")
  await assertExistingHierarchy(evidenceDirectory, absolutePath)
  return absolutePath
}
