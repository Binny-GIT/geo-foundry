import { describe, expect, it } from "vitest"
import {
  OPERATION_STATE,
  createOperationRetry,
  parseOperationId,
  transitionOperation,
  type Operation,
} from "../src/index.js"
import { clock, hash, operationId, ownership, unwrapResult, userActor } from "./fixtures.js"

const actor = userActor("editor")

function operation(state: Operation["state"]): Operation {
  return {
    id: unwrapResult(parseOperationId("operation-1")),
    attempt: 1,
    idempotencyKeyHash: hash,
    ownership,
    retryOf: null,
    state,
    revision: 3,
    audit: [],
  }
}

describe("transitionOperation", () => {
  it("returns running operation when queued operation starts", () => {
    // Given
    const queued = operation("queued")

    // When
    const result = transitionOperation(queued, "running", {
      actor,
      clock,
      expectedRevision: 3,
    })

    // Then
    expect(result).toEqual({
      ok: true,
      value: {
        ...queued,
        state: "running",
        revision: 4,
        audit: [
          {
            action: "operation.queued.running",
            actor,
            at: clock.now(),
          },
        ],
      },
    })
  })

  it("returns stable typed error when failed operation is reopened", () => {
    // Given
    const failed = operation("failed")

    // When
    const result = transitionOperation(failed, "running", {
      actor,
      clock,
      expectedRevision: 3,
    })

    // Then
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new TypeError("expected illegal transition")
    }
    expect(result.error).toMatchObject({
      code: "OPERATION_TRANSITION_NOT_ALLOWED",
      from: "failed",
      name: "InvalidTransitionError",
      to: "running",
    })
  })

  const states = Object.values(OPERATION_STATE)
  const allowed = new Set([
    "queued:running",
    "running:succeeded",
    "running:failed",
    "running:cancelled",
  ])

  it.each(states.flatMap((from) => states.map((to) => ({ from, to }))))(
    "returns the specified result for $from -> $to",
    ({ from, to }) => {
      // Given
      const current = operation(from)

      // When
      const result = transitionOperation(current, to, {
        actor,
        clock,
        expectedRevision: 3,
      })

      // Then
      expect(result.ok).toBe(allowed.has(`${from}:${to}`))
      if (!result.ok) {
        expect(result.error.code).toBe("OPERATION_TRANSITION_NOT_ALLOWED")
      }
    },
  )

  it("rejects a transition based on a stale revision", () => {
    // Given
    const queued = operation("queued")

    // When
    const result = transitionOperation(queued, "running", {
      actor,
      clock,
      expectedRevision: 2,
    })

    // Then
    expect(result).toMatchObject({
      error: { actualRevision: 3, code: "STALE_AGGREGATE_STATE", expectedRevision: 2 },
      ok: false,
    })
    expect(queued.state).toBe("queued")
  })

  it("creates a new queued attempt linked to a failed operation", () => {
    // Given
    const failed = operation("failed")
    const nextId = unwrapResult(parseOperationId("operation-2"))

    // When
    const result = createOperationRetry(failed, nextId, {
      actor,
      clock,
      expectedRevision: 3,
    })

    // Then
    expect(result).toMatchObject({
      ok: true,
      value: { attempt: 2, id: nextId, retryOf: operationId, state: "queued" },
    })
  })

  it("rejects retry creation from a non-failed operation", () => {
    // Given
    const succeeded = operation("succeeded")

    // When
    const result = createOperationRetry(succeeded, unwrapResult(parseOperationId("operation-2")), {
      actor,
      clock,
      expectedRevision: 3,
    })

    // Then
    expect(result).toMatchObject({
      error: { code: "OPERATION_RETRY_SOURCE_NOT_FAILED" },
      ok: false,
    })
  })

  it("rejects retry creation based on a stale revision", () => {
    // Given
    const failed = operation("failed")

    // When
    const result = createOperationRetry(failed, unwrapResult(parseOperationId("operation-2")), {
      actor,
      clock,
      expectedRevision: 2,
    })

    // Then
    expect(result).toMatchObject({ error: { code: "STALE_AGGREGATE_STATE" }, ok: false })
  })

  it.each(["queued", "running"] as const)("fails loudly for malformed target from %s", (state) => {
    // Given
    const current = operation(state)

    // When / Then
    expect(() =>
      Reflect.apply(transitionOperation, undefined, [
        current,
        "malformed",
        { actor, clock, expectedRevision: 3 },
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
  })

  it("fails loudly for malformed current state", () => {
    // Given
    const malformed = { ...operation("queued"), state: "malformed" }

    // When / Then
    expect(() =>
      Reflect.apply(transitionOperation, undefined, [
        malformed,
        "running",
        { actor, clock, expectedRevision: 3 },
      ]),
    ).toThrowError(expect.objectContaining({ code: "UNREACHABLE_STATE" }))
  })
})
