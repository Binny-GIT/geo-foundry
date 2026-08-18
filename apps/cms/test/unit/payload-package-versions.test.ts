import { describe, expect, it } from "vitest"

import {
  PayloadDependencyVersionError,
  REQUIRED_PAYLOAD_PACKAGES,
  verifyPayloadPackageVersions,
} from "../../src/config/payload-package-versions"

const alignedManifest = (): unknown => ({
  dependencies: Object.fromEntries(REQUIRED_PAYLOAD_PACKAGES.map((name) => [name, "3.88.0"])),
})

const captureVersionError = (manifest: unknown): PayloadDependencyVersionError => {
  try {
    verifyPayloadPackageVersions(manifest)
  } catch (error) {
    if (error instanceof PayloadDependencyVersionError) {
      return error
    }
    throw error
  }
  throw new TypeError("expected PayloadDependencyVersionError")
}

describe("Payload dependency alignment", () => {
  it("Given exact Payload packages, when verified, then the manifest is accepted", () => {
    expect(() => verifyPayloadPackageVersions(alignedManifest())).not.toThrow()
  })

  it("Given one mismatched adapter, when verified, then the mismatch is typed", () => {
    const manifest = alignedManifest()
    if (typeof manifest !== "object" || manifest === null || !("dependencies" in manifest)) {
      throw new TypeError("invalid test manifest")
    }
    const dependencies = manifest.dependencies
    if (typeof dependencies !== "object" || dependencies === null) {
      throw new TypeError("invalid test dependencies")
    }
    Object.assign(dependencies, { "@payloadcms/storage-s3": "3.87.0" })

    const error = captureVersionError(manifest)

    expect(error.actualVersion).toBe("3.87.0")
    expect(error.message).toBe("PAYLOAD_DEPENDENCY_VERSION_MISMATCH")
    expect(error.packageName).toBe("@payloadcms/storage-s3")
  })
})
