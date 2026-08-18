import { z } from "zod"

export const REQUIRED_ARTIFACT_PATHS = [
  "commands.json",
  "coverage/coverage-summary.json",
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
] as const

export const REQUIRED_REPORT_PATHS = [...REQUIRED_ARTIFACT_PATHS, "evidence-manifest.json"] as const

const isoInstantSchema = z.iso.datetime({ offset: false })
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const artifactPathSchema = z.enum(REQUIRED_ARTIFACT_PATHS)
const reportKindSchema = z.enum(["integration", "intentional-failure", "unit"])

export const testExecutionMetadataSchema = z
  .object({
    attempt: z.string().min(1),
    clockInstant: isoInstantSchema,
    fastCheckSeed: z.number().int(),
    locale: z.string().min(1),
    reportKind: reportKindSchema,
    seed: z.number().int(),
    timezone: z.literal("UTC"),
    vitestSeed: z.number().int(),
  })
  .strict()

export const commandRecordSchema = z
  .object({
    arguments: z.array(z.string()),
    command: z.string().min(1),
    completedAt: isoInstantSchema,
    exitCode: z.number().int().nonnegative(),
    kind: reportKindSchema,
    seed: z.number().int(),
    startedAt: isoInstantSchema,
    stderrPath: z.string().min(1),
    stdoutPath: z.string().min(1),
  })
  .strict()

export const evidenceManifestSchema = z
  .object({
    attempt: z.string().min(1),
    completedAt: isoInstantSchema,
    execution: z
      .object({
        fresh: z.boolean(),
        runner: z.literal("direct-vitest"),
        turboCache: z.enum(["bypassed", "read"]),
        vitestCache: z.literal("attempt-local"),
      })
      .strict(),
    reports: z.array(
      z
        .object({
          generatedAt: isoInstantSchema,
          path: artifactPathSchema,
          sha256: sha256Schema,
        })
        .strict(),
    ),
    seed: z.number().int(),
    startedAt: isoInstantSchema,
    version: z.literal(1),
  })
  .strict()

export const provenanceSchema = z
  .object({
    cacheSource: z.literal("none"),
    clockInstant: isoInstantSchema,
    fresh: z.boolean(),
    gitDirty: z.boolean(),
    gitHead: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("commit"), sha: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
      z.object({ kind: z.literal("unborn") }).strict(),
    ]),
    gitSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    gitStatus: z.array(z.string()),
    locale: z.string().min(1),
    lockfileSha256: sha256Schema,
    nodeVersion: z.string().min(1),
    pnpmVersion: z.string().min(1),
    recordedAt: isoInstantSchema,
    seed: z.number().int(),
    timezone: z.literal("UTC"),
    vitestCacheDirectory: z.literal(".vitest-cache"),
  })
  .strict()

export const evidenceReceiptSchema = z
  .object({
    canonicalManifestSha256: sha256Schema,
    createdAt: isoInstantSchema,
    provenanceSha256: sha256Schema,
    runIdentity: z
      .object({
        attempt: z.string().min(1),
        seed: z.number().int(),
        startedAt: isoInstantSchema,
      })
      .strict(),
    version: z.literal(1),
  })
  .strict()

export type CommandRecord = Readonly<z.output<typeof commandRecordSchema>>
export type EvidenceManifest = {
  readonly attempt: string
  readonly completedAt: string
  readonly execution: {
    readonly fresh: boolean
    readonly runner: "direct-vitest"
    readonly turboCache: "bypassed" | "read"
    readonly vitestCache: "attempt-local"
  }
  readonly reports: readonly {
    readonly generatedAt: string
    readonly path: ReportPath
    readonly sha256: string
  }[]
  readonly seed: number
  readonly startedAt: string
  readonly version: 1
}
export type ReportPath = z.output<typeof artifactPathSchema>
export type EvidenceReceipt = Readonly<z.output<typeof evidenceReceiptSchema>>
export type TestExecutionMetadata = Readonly<z.output<typeof testExecutionMetadataSchema>>
