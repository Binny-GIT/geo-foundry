export const QUALITY_SEVERITY = ["info", "minor", "major", "high", "critical"] as const

export type QualitySeverity = (typeof QUALITY_SEVERITY)[number]

const SEVERITY_WEIGHT: Readonly<Record<QualitySeverity, number>> = {
  critical: 5,
  high: 4,
  info: 1,
  major: 3,
  minor: 2,
}

export type QualityIssueLocation = {
  readonly blockId?: string
  readonly blockIndex?: number
  readonly field: string
}

export type QualityIssue = {
  readonly code: string
  readonly location: QualityIssueLocation
  readonly message: string
  readonly recommendation: string
  readonly severity: QualitySeverity
}

export const isBlockingSeverity = (severity: QualitySeverity): boolean =>
  severity === "high" || severity === "critical"

const locationKeyOf = (location: QualityIssueLocation): string =>
  [location.field, location.blockIndex ?? -1, location.blockId ?? ""].join("\u{0}")

/**
 * Total deterministic order: severity desc, then code, then location, then
 * message - so identical issue sets always serialize identically and no two
 * distinct issues compare equal.
 */
export const compareIssues = (left: QualityIssue, right: QualityIssue): number => {
  if (left.severity !== right.severity) {
    return SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity]
  }
  if (left.code !== right.code) {
    return left.code < right.code ? -1 : 1
  }
  const leftLocation = locationKeyOf(left.location)
  const rightLocation = locationKeyOf(right.location)
  if (leftLocation !== rightLocation) {
    return leftLocation < rightLocation ? -1 : 1
  }
  if (left.message !== right.message) {
    return left.message < right.message ? -1 : 1
  }
  return 0
}

export const sortIssues = (issues: readonly QualityIssue[]): readonly QualityIssue[] =>
  [...issues].sort(compareIssues)

export type SeverityAggregate = {
  readonly blocking: boolean
  readonly counts: Readonly<Record<QualitySeverity, number>>
}

export const aggregateSeverities = (issues: readonly QualityIssue[]): SeverityAggregate => {
  const counts: Record<QualitySeverity, number> = {
    critical: 0,
    high: 0,
    info: 0,
    major: 0,
    minor: 0,
  }
  for (const issue of issues) {
    counts[issue.severity] += 1
  }
  return {
    blocking: counts.critical > 0 || counts.high > 0,
    counts,
  }
}

export const serializeIssues = (issues: readonly QualityIssue[]): string => {
  const ordered = sortIssues(issues).map((issue) => ({
    code: issue.code,
    location: {
      ...(issue.location.blockId === undefined ? {} : { blockId: issue.location.blockId }),
      ...(issue.location.blockIndex === undefined ? {} : { blockIndex: issue.location.blockIndex }),
      field: issue.location.field,
    },
    message: issue.message,
    recommendation: issue.recommendation,
    severity: issue.severity,
  }))
  return JSON.stringify(ordered)
}
