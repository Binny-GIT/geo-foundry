import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

import { ReleaseManifestSchema, type ReleaseManifest } from "@geo/schema/release/v1"

import { JSON_CONTENT_TYPE, XML_CONTENT_TYPE } from "./build-release.js"
import { ReleaseBuildError, RELEASE_BUILD_ERROR_CODE } from "./errors.js"

export type VerifiedObject = {
  readonly bytes: number
  readonly contentType: string
  readonly path: string
  readonly sha256: string
}

export type VerifiedRelease = {
  readonly manifest: ReleaseManifest
  readonly objects: readonly VerifiedObject[]
  readonly releaseRoot: string
  readonly state: "validated"
}

const EXPECTED_CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: JSON_CONTENT_TYPE,
  xml: XML_CONTENT_TYPE,
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
}

const expectedContentTypeOf = (path: string): string => {
  const extension = path.split(".").at(-1) ?? ""
  const expected = EXPECTED_CONTENT_TYPES[extension]
  if (expected === undefined) {
    throw new ReleaseBuildError(
      RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_CONTENT_TYPE_MISMATCH,
      `object ${path} has no mapped content type for extension ".${extension}"`,
      "failed",
    )
  }
  return expected
}

const listFilesRecursively = async (root: string, prefix = ""): Promise<readonly string[]> => {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(root, relative)))
      continue
    }
    if (entry.isSymbolicLink()) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_PATH_UNSAFE,
        `release contains symlink ${relative}; only regular files are allowed`,
        "failed",
      )
    }
    files.push(relative)
  }
  return files
}

/**
 * Re-reads a staged release from disk and proves it: the manifest parses,
 * on-disk files and manifest objects are exactly the same set (no missing,
 * no extra), every byte count, hash, and content type matches the plan, and
 * no path escapes the release root. Any tampered byte keeps the release
 * below "validated".
 */
export const verifyReleaseDirectory = async (input: {
  readonly releaseRoot: string
}): Promise<VerifiedRelease> => {
  const releaseRoot = resolve(input.releaseRoot)
  let manifestRaw: Buffer
  try {
    manifestRaw = await readFile(join(releaseRoot, "manifest.json"))
  } catch {
    throw new ReleaseBuildError(
      RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_MISSING,
      "manifest.json is absent; the build never completed writing the release",
      "failed",
    )
  }
  const manifestParsed = ReleaseManifestSchema.safeParse(JSON.parse(manifestRaw.toString()))
  if (!manifestParsed.success) {
    throw new ReleaseBuildError(
      RELEASE_BUILD_ERROR_CODE.RELEASE_MANIFEST_INVALID,
      `manifest.json failed the release contract: ${manifestParsed.error.issues
        .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
        .join("; ")}`,
      "failed",
    )
  }
  const manifest = manifestParsed.data

  const present = new Set(await listFilesRecursively(releaseRoot))
  const listed = new Set<string>(manifest.objects.map((object) => object.path))
  for (const path of listed) {
    if (!present.has(path)) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_MISSING,
        `manifest lists ${path} but the release directory does not contain it`,
        "failed",
      )
    }
  }
  for (const path of present) {
    if (path !== "manifest.json" && !listed.has(path)) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_EXTRA,
        `release directory contains unlisted object ${path}`,
        "failed",
      )
    }
  }

  const objects: VerifiedObject[] = []
  for (const artifact of manifest.objects) {
    const target = join(releaseRoot, artifact.path)
    if (!target.startsWith(releaseRoot)) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_PATH_UNSAFE,
        `object path ${artifact.path} escapes the release root`,
        "failed",
      )
    }
    const body = await readFile(target)
    const info = await stat(target)
    if (info.size !== artifact.bytes || body.byteLength !== artifact.bytes) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_BYTES_MISMATCH,
        `object ${artifact.path} is ${body.byteLength} bytes, manifest says ${artifact.bytes}`,
        "failed",
      )
    }
    const sha256 = createHash("sha256").update(body).digest("hex")
    if (sha256 !== artifact.sha256) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_SHA256_MISMATCH,
        `object ${artifact.path} hashes to ${sha256}, manifest says ${artifact.sha256}`,
        "failed",
      )
    }
    const expectedContentType = expectedContentTypeOf(artifact.path)
    if (artifact.contentType !== expectedContentType) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_CONTENT_TYPE_MISMATCH,
        `object ${artifact.path} declares ${artifact.contentType}, path implies ${expectedContentType}`,
        "failed",
      )
    }
    objects.push({
      bytes: artifact.bytes,
      contentType: artifact.contentType,
      path: artifact.path,
      sha256: artifact.sha256,
    })
  }

  return { manifest, objects, releaseRoot, state: "validated" }
}
