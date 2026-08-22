import type { Payload, Where } from "payload"

import { CMS_ROLE } from "../../access/roles"

type DashboardProps = {
  readonly payload: Payload
  readonly user?: {
    readonly role?: unknown
  }
}

type Count = {
  readonly totalDocs: number
}

type OperationRow = {
  readonly id: number | string
  readonly operationId?: unknown
  readonly operationType?: unknown
  readonly state?: unknown
  readonly updatedAt?: unknown
}

type ReleaseRow = {
  readonly id: number | string
  readonly releaseId?: unknown
  readonly site?: unknown
}

const textOf = (value: unknown, fallback = "—"): string =>
  typeof value === "string" && value.length > 0 ? value : fallback

const relationshipLabel = (value: unknown): string => {
  if (typeof value === "object" && value !== null) {
    const row = value as Record<string, unknown>
    for (const key of ["name", "hostname", "releaseId", "id"]) {
      const label = row[key]
      if (typeof label === "string" || typeof label === "number") {
        return String(label)
      }
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value)
  }
  return "Unknown site"
}

const formatDate = (value: unknown): string => {
  if (typeof value !== "string") {
    return "Recently"
  }
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "Recently"
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
}

const ACCENTS = {
  approved: "#7c3aed",
  compiled: "#0891b2",
  failed: "#dc2626",
  review: "#d97706",
} as const

const cardShell = (accent: string) => ({
  background: "var(--theme-elevation-50)",
  border: "1px solid var(--theme-elevation-150)",
  borderTop: `3px solid ${accent}`,
  borderRadius: "0.6rem",
  boxShadow: "0 1px 2px rgb(15 23 42 / 6%)",
  minWidth: 0,
  padding: "1rem 1.1rem",
})

const panelStyle = {
  background: "var(--theme-elevation-50)",
  border: "1px solid var(--theme-elevation-150)",
  borderRadius: "0.6rem",
  minWidth: 0,
  padding: "1.1rem 1.2rem",
} as const

const OPERATION_STATE_PILL: Record<string, { bg: string; fg: string }> = {
  cancelled: { bg: "var(--theme-elevation-150)", fg: "var(--theme-elevation-600)" },
  failed: { bg: "var(--theme-error-100)", fg: "var(--theme-error-700)" },
  queued: { bg: "var(--theme-elevation-150)", fg: "var(--theme-elevation-600)" },
  running: { bg: "var(--theme-warning-100)", fg: "var(--theme-warning-700)" },
  succeeded: { bg: "var(--theme-success-100)", fg: "var(--theme-success-700)" },
}

const pillStyle = (background: string, color: string) => ({
  background,
  borderRadius: "999px",
  color,
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.02em",
  padding: "0.22rem 0.6rem",
  textTransform: "capitalize" as const,
  whiteSpace: "nowrap",
})

const operationPill = (state: string) =>
  pillStyle(
    OPERATION_STATE_PILL[state]?.bg ?? "var(--theme-elevation-150)",
    OPERATION_STATE_PILL[state]?.fg ?? "var(--theme-elevation-600)",
  )

const count = async (
  payload: Payload,
  user: DashboardProps["user"],
  collection: "content-editions" | "operations",
  where?: Where,
): Promise<Count> =>
  payload.count({
    collection,
    overrideAccess: false,
    ...(user === undefined ? {} : { user }),
    ...(where === undefined ? {} : { where }),
  })

const emptyStyle = {
  color: "var(--theme-elevation-600)",
  fontSize: "0.88rem",
  margin: 0,
  padding: "0.9rem 0 0.4rem",
}

const rowStyle = {
  alignItems: "center",
  borderTop: "1px solid var(--theme-elevation-100)",
  display: "flex",
  gap: "0.75rem",
  justifyContent: "space-between",
  padding: "0.65rem 0",
}

const siteChipStyle = {
  background: "var(--theme-elevation-100)",
  borderRadius: "999px",
  color: "var(--theme-elevation-600)",
  fontSize: "0.72rem",
  fontWeight: 600,
  padding: "0.2rem 0.55rem",
  whiteSpace: "nowrap",
} as const

/**
 * The operations workspace deliberately uses the Payload local API with
 * overrideAccess=false. Every aggregate inherits the viewer's existing role
 * and tenant scope instead of creating a privileged dashboard data path.
 */
export const OperationsWorkspace = async ({ payload, user }: DashboardProps) => {
  const canReadReleases = user?.role === CMS_ROLE.SUPER_ADMIN || user?.role === CMS_ROLE.PUBLISHER
  const canReadOperations =
    user?.role === CMS_ROLE.SUPER_ADMIN ||
    user?.role === CMS_ROLE.PUBLISHER ||
    user?.role === CMS_ROLE.EDITOR ||
    user?.role === CMS_ROLE.TENANT_ADMIN

  const [review, approved, compiled, currentReleases, recentOperations, failedOperations] =
    await Promise.all([
      count(payload, user, "content-editions", { workflowStatus: { equals: "review" } }),
      count(payload, user, "content-editions", { workflowStatus: { equals: "approved" } }),
      count(payload, user, "content-editions", { workflowStatus: { equals: "compiled" } }),
      canReadReleases
        ? payload.find({
            collection: "releases",
            depth: 1,
            limit: 5,
            overrideAccess: false,
            sort: "-updatedAt",
            user,
            where: { state: { equals: "current" } },
          })
        : Promise.resolve({ docs: [] as ReleaseRow[] }),
      canReadOperations
        ? payload.find({
            collection: "operations",
            depth: 0,
            limit: 6,
            overrideAccess: false,
            sort: "-updatedAt",
            user,
          })
        : Promise.resolve({ docs: [] as OperationRow[] }),
      canReadOperations
        ? count(payload, user, "operations", { state: { equals: "failed" } })
        : Promise.resolve({ totalDocs: 0 }),
    ])

  const cards = [
    {
      accent: ACCENTS.review,
      description: "Awaiting reviewer decision",
      emoji: "🔍",
      label: "Needs review",
      value: review.totalDocs,
    },
    {
      accent: ACCENTS.approved,
      description: "Passed review, awaiting compile",
      emoji: "✅",
      label: "Approved",
      value: approved.totalDocs,
    },
    {
      accent: ACCENTS.compiled,
      description: "Ready for a publisher to release",
      emoji: "🚀",
      label: "Ready to publish",
      value: compiled.totalDocs,
    },
    {
      accent: ACCENTS.failed,
      description: "Operations requiring attention",
      emoji: "⚠️",
      label: "Failed operations",
      value: failedOperations.totalDocs,
    },
  ]

  return (
    <section aria-label="Operations workspace" style={{ marginBottom: "2.25rem" }}>
      <div
        style={{
          alignItems: "end",
          display: "flex",
          gap: "1rem",
          justifyContent: "space-between",
          marginBottom: "1.1rem",
        }}
      >
        <div>
          <p
            style={{
              color: "#2563eb",
              fontSize: "0.72rem",
              fontWeight: 800,
              letterSpacing: "0.12em",
              margin: "0 0 0.35rem",
            }}
          >
            GEO FOUNDRY
          </p>
          <h2 style={{ fontSize: "1.55rem", letterSpacing: "-0.03em", margin: 0 }}>
            Operations workspace
          </h2>
        </div>
        <span
          style={{
            background: "var(--theme-elevation-100)",
            borderRadius: "999px",
            color: "var(--theme-elevation-600)",
            fontSize: "0.75rem",
            fontWeight: 600,
            padding: "0.3rem 0.75rem",
            whiteSpace: "nowrap",
          }}
        >
          Live view of your permitted scope
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gap: "0.9rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          marginBottom: "0.9rem",
        }}
      >
        {cards.map((card) => (
          <article key={card.label} style={cardShell(card.accent)}>
            <p
              style={{
                alignItems: "center",
                color: "var(--theme-elevation-600)",
                display: "flex",
                fontSize: "0.8rem",
                fontWeight: 600,
                gap: "0.4rem",
                margin: 0,
              }}
            >
              <span aria-hidden="true">{card.emoji}</span>
              {card.label}
            </p>
            <strong
              style={{
                display: "block",
                fontSize: "2.1rem",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.05em",
                lineHeight: 1.2,
                marginTop: "0.3rem",
              }}
            >
              {card.value}
            </strong>
            <p
              style={{
                color: "var(--theme-elevation-600)",
                fontSize: "0.75rem",
                lineHeight: 1.35,
                margin: "0.3rem 0 0",
              }}
            >
              {card.description}
            </p>
          </article>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gap: "0.9rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        }}
      >
        <article style={panelStyle}>
          <h3 style={{ fontSize: "1rem", letterSpacing: "-0.01em", margin: 0 }}>
            Current releases
          </h3>
          {currentReleases.docs.length === 0 ? (
            <p style={emptyStyle}>No current releases in your permitted scope yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {currentReleases.docs.map((release) => (
                <li key={String(release.id)} style={rowStyle}>
                  <span
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontSize: "0.82rem",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {textOf(release.releaseId)}
                  </span>
                  <span style={siteChipStyle}>{relationshipLabel(release.site)}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article style={panelStyle}>
          <h3 style={{ fontSize: "1rem", letterSpacing: "-0.01em", margin: 0 }}>
            Recent operations
          </h3>
          {recentOperations.docs.length === 0 ? (
            <p style={emptyStyle}>No operations recorded in your permitted scope yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {recentOperations.docs.map((operation) => {
                const state = textOf(operation.state, "queued")
                return (
                  <li key={String(operation.id)} style={rowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <strong
                        style={{
                          display: "block",
                          fontSize: "0.86rem",
                          textTransform: "capitalize",
                        }}
                      >
                        {textOf(operation.operationType)}
                      </strong>
                      <span
                        style={{
                          color: "var(--theme-elevation-600)",
                          fontSize: "0.74rem",
                          fontFamily: "ui-monospace, monospace",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {textOf(operation.operationId)} · {formatDate(operation.updatedAt)}
                      </span>
                    </div>
                    <span style={operationPill(state)}>{state}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </article>
      </div>
    </section>
  )
}
