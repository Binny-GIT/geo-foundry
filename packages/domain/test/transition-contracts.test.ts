import { describe, expect, it } from "vitest"
import {
  transitionContentEdition,
  transitionQualityAssessment,
  transitionRelease,
  transitionUrlRecord,
  type AuditActor,
  type AuditRecord,
  type ContentEdition,
  type QualityAssessment,
  type QualityEvidence,
  type QualityIssue,
  type SiteOwnership,
} from "../src/index.js"
import {
  assessmentId,
  clock,
  contentId,
  editionId,
  hash,
  ownership,
  releaseId,
  serviceActor,
  urlId,
  userActor,
} from "./fixtures.js"

describe("transition target exhaustiveness", () => {
  it.each([
    {
      invoke: () =>
        Reflect.apply(transitionContentEdition, undefined, [
          {
            audit: [],
            contentId,
            id: editionId,
            ownership,
            revision: 1,
            state: "review",
            version: 1,
          },
          "future-target",
          {
            actor: userActor("reviewer"),
            clock,
            expectedRevision: 1,
            qualityAssessmentState: null,
          },
        ]),
      machine: "ContentEdition",
    },
    {
      invoke: () =>
        Reflect.apply(transitionQualityAssessment, undefined, [
          {
            audit: [],
            evidence: {
              inputHash: hash,
              issues: [],
              modelId: "quality-model-1",
              promptVersion: "quality-v1",
              provider: "deterministic-fake",
              thresholdsHash: hash,
            },
            id: assessmentId,
            ownership,
            revision: 1,
            state: "pending",
          },
          "future-target",
          { actor: serviceActor, clock, expectedRevision: 1 },
        ]),
      machine: "QualityAssessment",
    },
    {
      invoke: () =>
        Reflect.apply(transitionRelease, undefined, [
          {
            audit: [],
            id: releaseId,
            manifestHash: hash,
            ownership,
            revision: 1,
            state: "building",
          },
          "future-target",
          {
            actor: serviceActor,
            clock,
            expectedRevision: 1,
            manifestVerified: false,
            pointerCasMatched: false,
          },
        ]),
      machine: "Release",
    },
    {
      invoke: () =>
        Reflect.apply(transitionUrlRecord, undefined, [
          {
            audit: [],
            contentId,
            id: urlId,
            locale: "en",
            ownership,
            pathname: "/articles/example",
            revision: 1,
            state: "reserved",
          },
          "future-target",
          { actor: serviceActor, clock, expectedRevision: 1, redirectTarget: null },
        ]),
      machine: "UrlRecord",
    },
  ])("routes an unhandled future $machine target to assertNever", ({ invoke }) => {
    // Given / When / Then
    expect(invoke).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
  })
})

describe("transition result immutability", () => {
  it("prevents mutation of a successful result and its exposed domain values", () => {
    // Given
    const mutableOwnership: SiteOwnership = { ...ownership }
    const mutableActor: AuditActor = { ...userActor("editor") }
    const historicalRecord: AuditRecord = {
      action: "content-edition.created",
      actor: mutableActor,
      at: { ...clock.now() },
    }
    const sourceAudit: AuditRecord[] = [historicalRecord]
    const draft: ContentEdition = {
      audit: sourceAudit,
      contentId,
      id: editionId,
      ownership: mutableOwnership,
      revision: 1,
      state: "draft",
      version: 1,
    }

    // When
    const result = transitionContentEdition(draft, "generating", {
      actor: userActor("editor"),
      clock,
      expectedRevision: 1,
      qualityAssessmentState: null,
    })

    // Then
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw result.error
    }
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.ownership)).toBe(true)
    expect(Object.isFrozen(result.value.audit)).toBe(true)
    expect(result.value.audit.every((record) => Object.isFrozen(record))).toBe(true)
    expect(result.value.audit.every((record) => Object.isFrozen(record.actor))).toBe(true)
    expect(result.value.audit.every((record) => Object.isFrozen(record.at))).toBe(true)
    expect(result.value.ownership).not.toBe(mutableOwnership)
    expect(result.value.audit).not.toBe(sourceAudit)
    expect(result.value.audit).not.toContain(historicalRecord)

    expect(Reflect.set(result, "ok", false)).toBe(false)
    expect(Reflect.set(result.value, "state", "published")).toBe(false)
    expect(Reflect.set(result.value.ownership, "scope", "tenant")).toBe(false)
    expect(Reflect.set(result.value.audit, "length", 0)).toBe(false)
    for (const record of result.value.audit) {
      expect(Reflect.set(record, "action", "tampered")).toBe(false)
      expect(Reflect.set(record.actor, "kind", "tampered")).toBe(false)
      expect(Reflect.set(record.at, "value", "tampered")).toBe(false)
    }

    expect(Reflect.set(mutableOwnership, "scope", "tenant")).toBe(true)
    expect(Reflect.set(mutableActor, "role", "publisher")).toBe(true)
    expect(result.value.ownership.scope).toBe("site")
    expect(result.value.audit).toContainEqual({
      action: "content-edition.created",
      actor: expect.objectContaining({ kind: "user", role: "editor" }),
      at: clock.now(),
    })
  })

  it("prevents mutation of a rejected Result and its typed error", () => {
    // Given
    const draft: ContentEdition = {
      audit: [],
      contentId,
      id: editionId,
      ownership,
      revision: 1,
      state: "draft",
      version: 1,
    }

    // When
    const result = transitionContentEdition(draft, "published", {
      actor: serviceActor,
      clock,
      expectedRevision: 1,
      qualityAssessmentState: null,
    })

    // Then
    expect(result.ok).toBe(false)
    if (result.ok) {
      expect.fail("expected an illegal transition")
    }
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.error)).toBe(true)
    expect(Reflect.set(result, "ok", true)).toBe(false)
    expect(Reflect.set(result.error, "code", "UNREACHABLE_STATE")).toBe(false)
    expect(result.error.code).toBe("CONTENT_EDITION_TRANSITION_NOT_ALLOWED")
  })

  it("detaches and freezes quality evidence nested in a transition aggregate", () => {
    // Given
    const mutableIssue: QualityIssue = { code: "SEO_TITLE", severity: "medium" }
    const mutableIssues: QualityIssue[] = [mutableIssue]
    const mutableEvidence: QualityEvidence = {
      inputHash: hash,
      issues: mutableIssues,
      modelId: "quality-model-1",
      promptVersion: "quality-v1",
      provider: "deterministic-fake",
      thresholdsHash: hash,
    }
    const pending: QualityAssessment = {
      audit: [],
      evidence: mutableEvidence,
      id: assessmentId,
      ownership: { ...ownership },
      revision: 1,
      state: "pending",
    }

    // When
    const result = transitionQualityAssessment(pending, "running", {
      actor: serviceActor,
      clock,
      expectedRevision: 1,
    })

    // Then
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw result.error
    }
    expect(Object.isFrozen(result.value.evidence)).toBe(true)
    expect(Object.isFrozen(result.value.evidence.issues)).toBe(true)
    expect(result.value.evidence.issues.every((issue) => Object.isFrozen(issue))).toBe(true)
    expect(result.value.evidence).not.toBe(mutableEvidence)
    expect(result.value.evidence.issues).not.toBe(mutableIssues)
    expect(result.value.evidence.issues).not.toContain(mutableIssue)

    expect(Reflect.set(mutableEvidence, "provider", "tampered-provider")).toBe(true)
    expect(Reflect.set(mutableIssue, "code", "TAMPERED")).toBe(true)
    expect(result.value.evidence.provider).toBe("deterministic-fake")
    expect(result.value.evidence.issues).toContainEqual({
      code: "SEO_TITLE",
      severity: "medium",
    })
  })
})
