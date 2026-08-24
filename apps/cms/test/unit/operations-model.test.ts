import { describe, expect, it } from "vitest"

import {
  groupBySite,
  siteWorkflowSummary,
  summarizeDomains,
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
})
