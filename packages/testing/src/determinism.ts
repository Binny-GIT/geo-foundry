import { TestHarnessConfigurationError } from "./errors.js"

export const DEFAULT_TEST_SEED = 260_817
export const TEST_CLOCK_INSTANT = "2026-08-18T00:00:00.000Z"
export const TEST_LOCALE = "en-US"
export const TEST_TIMEZONE = "UTC"

export type TestClock = {
  readonly now: () => Date
}

export type FastCheckParameters = {
  readonly seed: number
}

export const createFixedClock = (instant: string): TestClock => {
  const timestamp = Date.parse(instant)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== instant) {
    throw new TestHarnessConfigurationError("TEST_CLOCK_INSTANT_INVALID")
  }
  return Object.freeze({ now: () => new Date(timestamp) })
}

export const createSeededRandom = (seed: number): (() => number) => {
  if (!Number.isSafeInteger(seed)) {
    throw new TestHarnessConfigurationError("TEST_SEED_INVALID")
  }
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

export const deterministicFastCheckParameters = (seed: number): FastCheckParameters => {
  if (!Number.isSafeInteger(seed)) {
    throw new TestHarnessConfigurationError("TEST_SEED_INVALID")
  }
  return Object.freeze({ seed })
}

export const parseTestSeed = (value: string | undefined): number => {
  const seed = value === undefined ? DEFAULT_TEST_SEED : Number(value)
  if (!Number.isSafeInteger(seed)) {
    throw new TestHarnessConfigurationError("TEST_SEED_INVALID")
  }
  return seed
}
