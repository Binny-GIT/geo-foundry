export type GitHead =
  | { readonly kind: "commit"; readonly sha: string }
  | { readonly kind: "unborn" }

export type ProvenanceInput = {
  readonly clockInstant: string
  readonly fresh: boolean
  readonly gitHead: GitHead
  readonly gitStatus: readonly string[]
  readonly locale: string
  readonly lockfileSha256: string
  readonly nodeVersion: string
  readonly pnpmVersion: string
  readonly recordedAt: string
  readonly seed: number
  readonly timezone: string
  readonly vitestCacheDirectory: ".vitest-cache"
}

export type Provenance = ProvenanceInput & {
  readonly cacheSource: "none"
  readonly gitDirty: boolean
  readonly gitSha: string | null
}

export const buildProvenance = (input: ProvenanceInput): Provenance => {
  const gitHead = Object.freeze({ ...input.gitHead })
  const gitStatus = Object.freeze([...input.gitStatus])
  return Object.freeze({
    ...input,
    cacheSource: "none",
    gitDirty: gitStatus.length > 0,
    gitHead,
    gitSha: gitHead.kind === "commit" ? gitHead.sha : null,
    gitStatus,
  })
}
