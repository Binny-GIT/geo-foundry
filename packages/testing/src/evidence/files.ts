import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"

import type { ReportPath } from "./model.js"

export const sha256 = (contents: Uint8Array): string =>
  createHash("sha256").update(contents).digest("hex")

export const writeJson = async (path: string, value: object): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
}

export const readJson = async (path: string): Promise<unknown> =>
  z.json().parse(JSON.parse(await readFile(path, "utf8")))

export type ReportRecord = {
  readonly generatedAt: string
  readonly path: ReportPath
  readonly sha256: string
}

export const createReportRecord = async (
  evidenceDirectory: string,
  path: ReportPath,
): Promise<ReportRecord> => {
  const absolutePath = resolve(evidenceDirectory, path)
  const [contents, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)])
  return Object.freeze({
    generatedAt: metadata.mtime.toISOString(),
    path,
    sha256: sha256(contents),
  })
}
