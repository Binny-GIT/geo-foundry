import { describe, expect, it } from "vitest"

import { parseDeliveryEnvironment } from "../../src/config/environment.js"

const environment = {
  GEO_FOUNDRY_DELIVERY_SITE_KEYRING_FILE: "/tmp/site-keyring.json",
} as const

describe("parseDeliveryEnvironment", () => {
  it("requires a configured public origin before reading S3 credentials", () => {
    expect(() => parseDeliveryEnvironment(environment)).toThrow(
      "DELIVERY_ENV_REQUIRED:GEO_FOUNDRY_DELIVERY_PUBLIC_ORIGIN",
    )
  })

  it.each([
    "javascript:alert(1)",
    "https://public.test/path",
    "https://public.test/?q=1",
    "https://user:password@public.test",
  ])("rejects an invalid public origin: %s", (origin) => {
    expect(() =>
      parseDeliveryEnvironment({ ...environment, GEO_FOUNDRY_DELIVERY_PUBLIC_ORIGIN: origin }),
    ).toThrow("DELIVERY_ENV_INVALID:GEO_FOUNDRY_DELIVERY_PUBLIC_ORIGIN")
  })
})
