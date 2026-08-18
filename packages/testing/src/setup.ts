import { configureGlobal, readConfigureGlobal } from "fast-check"

import {
  deterministicFastCheckParameters,
  TEST_CLOCK_INSTANT,
  TEST_LOCALE,
  TEST_TIMEZONE,
} from "./determinism.js"
import { configuredTestSeed } from "./vitest-runtime.js"

const seed = configuredTestSeed()

Object.assign(process.env, {
  GEO_FOUNDRY_TEST_CLOCK_INSTANT: TEST_CLOCK_INSTANT,
  GEO_FOUNDRY_TEST_LOCALE: TEST_LOCALE,
  GEO_FOUNDRY_TEST_SEED: String(seed),
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  TZ: TEST_TIMEZONE,
})
configureGlobal(deterministicFastCheckParameters(seed))
process.stdout.write(`GEO_FOUNDRY_FAST_CHECK_SEED=${readConfigureGlobal().seed}\n`)
