import { describe, expect, it } from "vitest"

import {
  formatDate,
  groupBySite,
  operationHealth,
  siteReadiness,
  siteWorkflowSummary,
  sortSiteWorkload,
  summarizeDomains,
  workflowBottleneck,
  workflowCounts,
  WORKFLOW_STATES,
} from "../../src/components/dashboard/operations-model"

describe("operations dashboard view model", () => {
  it("Given editions in multiple workflow states, when summarized, then every real state has an isolated count", () => {
    const counts = workflowCounts([
      { workflowStatus: "draft" },
      { workflowStatus: "review" },
      { workflowStatus: "review" },
      { workflowStatus: "compiled" },
      { workflowStatus: "invalid" },
    ])

    expect(Object.keys(counts)).toEqual([...WORKFLOW_STATES])
    expect(counts.draft).toBe(1)
    expect(counts.review).toBe(2)
    expect(counts.compiled).toBe(1)
    expect(counts.published).toBe(0)
    expect(siteWorkflowSummary(counts)).toBe(
      "1 draft · 2 review · 0 approved · 1 compiled · 0 published",
    )
  })

  it("Given actionable workflow counts, when finding the bottleneck, then it selects the largest nonterminal queue", () => {
    expect(
      workflowBottleneck(
        workflowCounts([
          { workflowStatus: "published" },
          { workflowStatus: "review" },
          { workflowStatus: "compiled" },
          { workflowStatus: "compiled" },
        ]),
      ),
    ).toEqual({ count: 2, state: "compiled" })
    expect(workflowBottleneck(workflowCounts([{ workflowStatus: "published" }]))).toBeNull()
  })

  it("Given active, disabled, and alias domains, when summarized, then canonical readiness is derived without leaking across sites", () => {
    const summaries = summarizeDomains([
      { hostname: "a.example.test", role: "canonical", site: 1, status: "active" },
      { hostname: "www.a.example.test", role: "alias", site: 1, status: "active" },
      { hostname: "b.example.test", role: "canonical", site: 2, status: "disabled" },
      { hostname: "old.b.example.test", role: "alias", site: 2, status: "disabled" },
    ])

    expect(summaries.get("1")).toEqual({
      aliases: 1,
      canonicalDisabled: false,
      canonicalHostname: "a.example.test",
      configured: true,
    })
    expect(summaries.get("2")).toEqual({
      aliases: 0,
      canonicalDisabled: true,
      canonicalHostname: null,
      configured: true,
    })
  })

  it("Given rows related to multiple sites, when grouped, then each site retains only its own rows", () => {
    const grouped = groupBySite([
      { id: "edition-a", site: 1, workflowStatus: "review" },
      { id: "edition-b", site: 2, workflowStatus: "compiled" },
      { id: "edition-c", site: 1, workflowStatus: "published" },
    ])

    expect(grouped.get("1")?.map((row) => row["id"])).toEqual(["edition-a", "edition-c"])
    expect(grouped.get("2")?.map((row) => row["id"])).toEqual(["edition-b"])
  })

  it("Given visible sites, domains, releases, and edition workload, when readiness is derived, then the proxy labels remain explicit and isolated", () => {
    const domains = summarizeDomains([
      { hostname: "ready.example.test", role: "canonical", site: "ready", status: "active" },
      { hostname: "publish.example.test", role: "canonical", site: "publish", status: "active" },
      { hostname: "disabled.example.test", role: "canonical", site: "disabled", status: "active" },
    ])
    const editions = groupBySite([
      { site: "configure", workflowStatus: "review" },
      { site: "publish", workflowStatus: "compiled" },
      { site: "ready", workflowStatus: "published" },
    ])
    const rows = siteReadiness({
      canReadReleases: true,
      currentReleaseSiteIds: new Set(["ready"]),
      domains,
      editionsBySite: editions,
      sites: [
        { id: "ready", status: "active" },
        { id: "publish", status: "active" },
        { id: "configure", status: "active" },
        { id: "disabled", status: "disabled" },
      ],
    })

    expect(rows.map((row) => [row.id, row.readiness])).toEqual([
      ["ready", "ready"],
      ["publish", "publish"],
      ["configure", "configure"],
      ["disabled", "disabled"],
    ])
    expect(rows.find((row) => row.id === "configure")?.counts.review).toBe(1)
    expect(rows.find((row) => row.id === "publish")?.counts.compiled).toBe(1)
    expect(sortSiteWorkload(rows).map((row) => row.id)).toEqual([
      "configure",
      "publish",
      "disabled",
      "ready",
    ])
    expect(
      siteReadiness({
        canReadReleases: false,
        currentReleaseSiteIds: new Set(),
        domains,
        editionsBySite: editions,
        sites: [{ id: "ready", status: "active" }],
      })[0]?.readiness,
    ).toBe("restricted")
  })

  it("Given operations with invalid entries, when health is aggregated, then only valid type and state combinations contribute", () => {
    const health = operationHealth([
      { operationType: "publish", state: "succeeded" },
      { operationType: "publish", state: "failed" },
      { operationType: "generate", state: "running" },
      { operationType: "unknown", state: "failed" },
      { operationType: "rollback", state: "unknown" },
    ])

    expect(health.publish).toMatchObject({ failed: 1, succeeded: 1 })
    expect(health.generate.running).toBe(1)
    expect(health.rollback.failed).toBe(0)
  })

  it("Given a selected UI language, when formatting timestamps, then it uses that locale and keeps a localized fallback", () => {
    const timestamp = "2026-08-25T10:30:00.000Z"
    expect(formatDate(timestamp, "en")).toContain("Aug")
    expect(formatDate(timestamp, "zh")).toMatch(/8月|08月/)
    expect(formatDate(undefined, "en")).toBe("Recently")
    expect(formatDate(undefined, "zh")).toBe("最近")
  })
})
