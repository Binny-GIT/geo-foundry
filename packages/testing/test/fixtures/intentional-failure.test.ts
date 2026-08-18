import { expect, it } from "vitest"

it("reports the intentional harness failure", () => {
  // Given
  const expected = "reported-failure"

  // When
  const actual = "unexpected-success"

  // Then
  expect(actual).toBe(expected)
})
