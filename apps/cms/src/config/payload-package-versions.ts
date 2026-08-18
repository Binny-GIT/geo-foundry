import { z } from "zod"

export const PAYLOAD_PACKAGE_VERSION = "3.88.0"

export const REQUIRED_PAYLOAD_PACKAGES = [
  "payload",
  "@payloadcms/db-postgres",
  "@payloadcms/plugin-multi-tenant",
  "@payloadcms/storage-s3",
  "@payloadcms/next",
] as const

const packageManifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
})

export class PayloadDependencyVersionError extends Error {
  override readonly name = "PayloadDependencyVersionError"

  constructor(
    readonly packageName: (typeof REQUIRED_PAYLOAD_PACKAGES)[number],
    readonly actualVersion: string | undefined,
  ) {
    super("PAYLOAD_DEPENDENCY_VERSION_MISMATCH")
  }
}

export const verifyPayloadPackageVersions = (manifest: unknown): void => {
  const parsed = packageManifestSchema.parse(manifest)
  for (const packageName of REQUIRED_PAYLOAD_PACKAGES) {
    const actualVersion = parsed.dependencies[packageName]
    if (actualVersion !== PAYLOAD_PACKAGE_VERSION) {
      throw new PayloadDependencyVersionError(packageName, actualVersion)
    }
  }
}
