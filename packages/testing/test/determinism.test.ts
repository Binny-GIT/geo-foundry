import { readConfigureGlobal } from "fast-check"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"

import {
  createFixedClock,
  createSeededRandom,
  deterministicFastCheckParameters,
} from "../src/index.js"
import { readTestEnvironment } from "../src/vitest-runtime.js"
import { config } from "../vitest.config.js"

describe("确定性测试运行时", () => {
  it("在给定固定时刻时返回互不别名的相同 UTC 时间", () => {
    // Given
    const instant = "2026-08-17T12:34:56.789Z"
    const clock = createFixedClock(instant)

    // When
    const first = clock.now()
    const second = clock.now()

    // Then
    expect(first.toISOString()).toBe(instant)
    expect(second.toISOString()).toBe(instant)
    expect(second).not.toBe(first)
  })

  it("在给定相同种子时生成相同且有界的随机序列", () => {
    // Given
    const firstRandom = createSeededRandom(42)
    const secondRandom = createSeededRandom(42)

    // When
    const firstSequence = Array.from({ length: 5 }, firstRandom)
    const secondSequence = Array.from({ length: 5 }, secondRandom)

    // Then
    expect(firstSequence).toEqual(secondSequence)
    expect(firstSequence.every((value) => value >= 0 && value < 1)).toBe(true)
    expect(new Set(firstSequence).size).toBeGreaterThan(1)
  })

  it("在给定 fast-check 种子时保留该种子", () => {
    // Given
    const seed = 17_081

    // When
    const parameters = deterministicFastCheckParameters(seed)

    // Then
    expect(parameters).toEqual({ seed })
  })

  it("使用同一个环境种子驱动 Vitest 与 fast-check", () => {
    // Given
    const expectedSeed = Number(
      readTestEnvironment("GEO_FOUNDRY_EXPECTED_TEST_SEED") ??
        readTestEnvironment("GEO_FOUNDRY_TEST_SEED"),
    )

    // When
    const vitestSeed = config.test?.sequence?.seed
    const fastCheckSeed = readConfigureGlobal().seed

    // Then
    expect(vitestSeed).toBe(expectedSeed)
    expect(fastCheckSeed).toBe(expectedSeed)
  })

  it("将 Vitest 缓存限制在证据目录或系统临时目录", () => {
    // Given
    const evidenceDirectory = readTestEnvironment("GEO_FOUNDRY_EVIDENCE_DIR")

    // When
    const cacheDirectory = config.cacheDir

    // Then
    expect(cacheDirectory).toBeDefined()
    expect(cacheDirectory).not.toContain("node_modules/.vite")
    if (evidenceDirectory !== undefined) {
      expect(cacheDirectory).toContain(evidenceDirectory)
    } else {
      expect(cacheDirectory).toContain(tmpdir())
    }
  })
})
