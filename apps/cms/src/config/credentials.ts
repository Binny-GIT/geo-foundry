import { readFileSync, statSync } from "node:fs"

export class CmsCredentialFileError extends Error {
  override readonly name = "CmsCredentialFileError"

  constructor(readonly variables: readonly string[]) {
    super("CMS_CREDENTIAL_FILE_INVALID")
  }
}

const strictFileMode = (environment: Record<string, string | undefined>): boolean =>
  environment["GEO_FOUNDRY_CREDENTIAL_MODE"] === "file"

const readFileCredential = (fileVariable: string, path: string): string => {
  let metadata: ReturnType<typeof statSync>
  try {
    metadata = statSync(path)
  } catch {
    throw new CmsCredentialFileError([fileVariable])
  }
  const ownerId = process.getuid?.()
  if (ownerId === undefined || metadata.uid !== ownerId || (metadata.mode & 0o077) !== 0) {
    throw new CmsCredentialFileError([fileVariable])
  }
  let value: string
  try {
    value = readFileSync(path, "utf8").trim()
  } catch {
    throw new CmsCredentialFileError([fileVariable])
  }
  if (value.length === 0) throw new CmsCredentialFileError([fileVariable])
  return value
}

export const optionalCmsCredential = (
  environment: Record<string, string | undefined>,
  variable: string,
  fileVariable = `${variable}_FILE`,
): string | undefined => {
  const direct = environment[variable]?.trim()
  const path = environment[fileVariable]?.trim()
  if (strictFileMode(environment) && direct !== undefined && direct.length > 0) {
    throw new CmsCredentialFileError([variable])
  }
  if (path !== undefined && path.length > 0) return readFileCredential(fileVariable, path)
  if (!strictFileMode(environment) && direct !== undefined && direct.length > 0) return direct
  return undefined
}

export const requireCmsCredential = (
  environment: Record<string, string | undefined>,
  variable: string,
  fileVariable = `${variable}_FILE`,
): string => {
  const value = optionalCmsCredential(environment, variable, fileVariable)
  if (value === undefined) {
    throw new CmsCredentialFileError([strictFileMode(environment) ? fileVariable : variable])
  }
  return value
}
