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

const cardStyle = {
  background: "var(--theme-elevation-50)",
  border: "1px solid var(--theme-elevation-150)",
  borderRadius: "0.5rem",
  minWidth: 0,
  padding: "1rem",
} as const

const statusStyle = (failed: boolean) => ({
  background: failed ? "var(--theme-error-100)" : "var(--theme-success-100)",
  borderRadius: "999px",
  color: failed ? "var(--theme-error-700)" : "var(--theme-success-700)",
  fontSize: "0.72rem",
  fontWeight: 700,
  padding: "0.18rem 0.5rem",
})

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
      description: "Editions awaiting reviewer decision",
      label: "Needs review",
      value: review.totalDocs,
    },
    {
      description: "Passed review and awaiting compilation",
      label: "Approved",
      value: approved.totalDocs,
    },
    {
      description: "Ready for a publisher to release",
      label: "Ready to publish",
      value: compiled.totalDocs,
    },
    {
      description: "Operations requiring attention",
      label: "Failed operations",
      value: failedOperations.totalDocs,
    },
  ]

  return (
    <section aria-label="Operations workspace" style={{ marginBottom: "2rem" }}>
      <div
        style={{
          alignItems: "end",
          display: "flex",
          gap: "1rem",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <div>
          <p
            style={{
              color: "#2563eb",
              fontSize: "0.72rem",
              fontWeight: 800,
              letterSpacing: "0.1em",
              margin: "0 0 0.3rem",
            }}
          >
            GEO FOUNDRY
          </p>
          <h2 style={{ fontSize: "1.5rem", letterSpacing: "-0.025em", margin: 0 }}>
            Operations workspace
          </h2>
        </div>
        <span style={{ color: "var(--theme-elevation-600)", fontSize: "0.85rem" }}>
          Live view of your permitted scope
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gap: "0.8rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          marginBottom: "0.8rem",
        }}
      >
        {cards.map((card) => (
          <article key={card.label} style={cardStyle}>
            <p style={{ color: "var(--theme-elevation-600)", fontSize: "0.8rem", margin: 0 }}>
              {card.label}
            </p>
            <strong
              style={{
                display: "block",
                fontSize: "2rem",
                letterSpacing: "-0.05em",
                marginTop: "0.35rem",
              }}
            >
              {card.value}
            </strong>
            <p
              style={{
                color: "var(--theme-elevation-600)",
                fontSize: "0.75rem",
                lineHeight: 1.35,
                margin: "0.35rem 0 0",
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
          gap: "0.8rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        }}
      >
        <article style={cardStyle}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Current releases</h3>
          {currentReleases.docs.length === 0 ? (
            <p style={{ color: "var(--theme-elevation-600)", margin: 0 }}>
              No current releases in your permitted scope.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {currentReleases.docs.map((release) => (
                <li
                  key={String(release.id)}
                  style={{
                    alignItems: "center",
                    borderTop: "1px solid var(--theme-elevation-100)",
                    display: "flex",
                    gap: "0.75rem",
                    justifyContent: "space-between",
                    padding: "0.6rem 0",
                  }}
                >
                  <span>{textOf(release.releaseId)}</span>
                  <span style={{ color: "var(--theme-elevation-600)", fontSize: "0.8rem" }}>
                    {relationshipLabel(release.site)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article style={cardStyle}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Recent operations</h3>
          {recentOperations.docs.length === 0 ? (
            <p style={{ color: "var(--theme-elevation-600)", margin: 0 }}>
              No operations recorded in your permitted scope.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {recentOperations.docs.map((operation) => {
                const state = textOf(operation.state, "queued")
                return (
                  <li
                    key={String(operation.id)}
                    style={{
                      alignItems: "center",
                      borderTop: "1px solid var(--theme-elevation-100)",
                      display: "flex",
                      gap: "0.65rem",
                      justifyContent: "space-between",
                      padding: "0.6rem 0",
                    }}
                  >
                    <div>
                      <strong style={{ display: "block", fontSize: "0.86rem" }}>
                        {textOf(operation.operationType)}
                      </strong>
                      <span style={{ color: "var(--theme-elevation-600)", fontSize: "0.75rem" }}>
                        {textOf(operation.operationId)} · {formatDate(operation.updatedAt)}
                      </span>
                    </div>
                    <span style={statusStyle(state === "failed")}>{state}</span>
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
