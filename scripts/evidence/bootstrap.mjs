import { spawnSync } from "node:child_process"
import { lstat, mkdir, realpath, rm } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

const readEnvironment = (name) => process.env[name]

const requestedDirectory = (argumentsList) => {
  let directory = readEnvironment("GEO_FOUNDRY_EVIDENCE_DIR") ?? ".omo/evidence/task-7"
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] === "--output-dir" && argumentsList[index + 1] !== undefined) {
      directory = argumentsList[index + 1]
      index += 1
    }
  }
  return directory
}

const isMissingPathError = (error) =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

const evidenceDirectory = async (workspaceRoot, argumentsList) => {
  const lexicalWorkspaceRoot = resolve(workspaceRoot)
  const workspaceMetadata = await lstat(lexicalWorkspaceRoot)
  const canonicalWorkspaceRoot = await realpath(lexicalWorkspaceRoot)
  if (workspaceMetadata.isSymbolicLink() || canonicalWorkspaceRoot !== lexicalWorkspaceRoot) {
    process.stderr.write(
      `${JSON.stringify({ code: "EVIDENCE_WORKSPACE_NOT_CANONICAL", paths: [lexicalWorkspaceRoot] })}\n`,
    )
    return undefined
  }
  const directory = resolve(canonicalWorkspaceRoot, requestedDirectory(argumentsList))
  const workspaceRelative = relative(canonicalWorkspaceRoot, directory)
  const segments = workspaceRelative.split(sep)
  if (
    workspaceRelative.length === 0 ||
    workspaceRelative === ".." ||
    workspaceRelative.startsWith(`..${sep}`) ||
    isAbsolute(workspaceRelative)
  ) {
    process.stderr.write(
      `${JSON.stringify({ code: "EVIDENCE_PATH_OUTSIDE_WORKSPACE", paths: [workspaceRelative] })}\n`,
    )
    return undefined
  }
  if (
    segments[0] !== ".omo" ||
    segments[1] !== "evidence" ||
    segments.length < 3 ||
    segments[2].startsWith(".")
  ) {
    process.stderr.write(
      `${JSON.stringify({ code: "EVIDENCE_PATH_UNSAFE", paths: [workspaceRelative] })}\n`,
    )
    return undefined
  }
  let currentPath = canonicalWorkspaceRoot
  for (const segment of segments) {
    currentPath = resolve(currentPath, segment)
    try {
      const metadata = await lstat(currentPath)
      if (metadata.isSymbolicLink()) {
        process.stderr.write(
          `${JSON.stringify({ code: "EVIDENCE_PATH_SYMLINK", paths: [workspaceRelative] })}\n`,
        )
        return undefined
      }
      const canonicalPath = await realpath(currentPath)
      const canonicalRelative = relative(canonicalWorkspaceRoot, canonicalPath)
      if (
        canonicalRelative === ".." ||
        canonicalRelative.startsWith(`..${sep}`) ||
        isAbsolute(canonicalRelative)
      ) {
        process.stderr.write(
          `${JSON.stringify({ code: "EVIDENCE_PATH_OUTSIDE_WORKSPACE", paths: [canonicalRelative] })}\n`,
        )
        return undefined
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        break
      }
      throw error
    }
  }
  return directory
}

export const runEvidenceCommand = async (action, argumentsList) => {
  const workspaceRoot = process.cwd()
  const directory = await evidenceDirectory(workspaceRoot, argumentsList)
  if (directory === undefined) {
    return 1
  }
  await mkdir(directory, { recursive: true })
  const checkedDirectory = await evidenceDirectory(workspaceRoot, argumentsList)
  if (checkedDirectory === undefined) {
    return 1
  }
  const outputDirectory = join(directory, ".harness-bin")
  await rm(outputDirectory, { force: true, recursive: true })
  const compiler = spawnSync(
    "pnpm",
    [
      "--filter",
      "@geo/testing",
      "exec",
      "tsc",
      "--project",
      "tsconfig.build.json",
      "--outDir",
      outputDirectory,
      "--declaration",
      "false",
      "--declarationMap",
      "false",
      "--sourceMap",
      "false",
    ],
    { cwd: workspaceRoot, encoding: "utf8" },
  )
  if (compiler.status !== 0) {
    process.stdout.write(compiler.stdout)
    process.stderr.write(compiler.stderr)
    return compiler.status ?? 1
  }
  const harness = await import(pathToFileURL(join(outputDirectory, "evidence", "cli.js")).href)
  switch (action) {
    case "run":
      return harness.runHarnessCli(argumentsList, workspaceRoot)
    case "verify":
      return harness.verifyEvidenceCli(argumentsList, workspaceRoot)
    default:
      return 1
  }
}
