import { describe, expect, it } from "vitest"

import { siteFormValuesFromDocument, siteMutationPayload } from "./site-form"

describe("Console Site form mapping", () => {
  it("maps every Sites schema field from a REST document into editable form values", () => {
    const values = siteFormValuesFromDocument({
      contentStrategy: {
        contentAngles: ["Practical guidance"],
        expertise: ["Content operations"],
        language: "English",
        positioning: "Trusted operator",
        preferredTopics: ["Governance"],
        prohibitedTopics: ["Medical advice"],
        targetAudience: ["Operations leaders"],
        tone: "Clear",
      },
      locale: "en-GB",
      name: "Northstar",
      qualityThresholds: {
        crossDomainBlock: 0.95,
        crossDomainReview: 0.87,
        dimensionMinimum: 76,
        overallMinimum: 82,
        sameSiteTitleBlock: 0.91,
      },
      seoDefaults: {
        defaultDescription: "Operational content.",
        titleSuffix: " | Northstar",
      },
      status: "disabled",
      timezone: "Europe/London",
    })

    expect(values).toEqual({
      contentStrategy: {
        contentAngles: ["Practical guidance"],
        expertise: ["Content operations"],
        language: "English",
        positioning: "Trusted operator",
        preferredTopics: ["Governance"],
        prohibitedTopics: ["Medical advice"],
        targetAudience: ["Operations leaders"],
        tone: "Clear",
      },
      locale: "en-GB",
      name: "Northstar",
      qualityThresholds: {
        crossDomainBlock: "0.95",
        crossDomainReview: "0.87",
        dimensionMinimum: "76",
        overallMinimum: "82",
        sameSiteTitleBlock: "0.91",
      },
      seoDefaults: {
        defaultDescription: "Operational content.",
        titleSuffix: " | Northstar",
      },
      status: "disabled",
      timezone: "Europe/London",
    })
  })

  it("emits all and only mutable Sites schema fields without tenant", () => {
    const result = siteMutationPayload({
      contentStrategy: {
        contentAngles: [" guidance ", ""],
        expertise: ["operations"],
        language: " English ",
        positioning: " Trusted operator ",
        preferredTopics: [" governance "],
        prohibitedTopics: [" medical "],
        targetAudience: [" leaders "],
        tone: " Clear ",
      },
      locale: " en-US ",
      name: " Northstar ",
      qualityThresholds: {
        crossDomainBlock: "0.92",
        crossDomainReview: "0.85",
        dimensionMinimum: "75",
        overallMinimum: "80",
        sameSiteTitleBlock: "0.9",
      },
      seoDefaults: {
        defaultDescription: " Default description ",
        titleSuffix: " | Northstar ",
      },
      status: "active",
      timezone: " America/New_York ",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(Object.keys(result.data).sort()).toEqual([
      "contentStrategy",
      "locale",
      "name",
      "qualityThresholds",
      "seoDefaults",
      "status",
      "timezone",
    ])
    expect(result.data).toMatchObject({
      contentStrategy: {
        contentAngles: ["guidance"],
        language: "English",
        positioning: "Trusted operator",
      },
      locale: "en-US",
      name: "Northstar",
      seoDefaults: {
        defaultDescription: "Default description",
        titleSuffix: "| Northstar",
      },
      timezone: "America/New_York",
    })
    expect(result.data).not.toHaveProperty("tenant")
  })

  it("rejects threshold values outside the Sites schema bounds", () => {
    const result = siteMutationPayload({
      ...siteFormValuesFromDocument(undefined),
      name: "Northstar",
      qualityThresholds: {
        ...siteFormValuesFromDocument(undefined).qualityThresholds,
        overallMinimum: "101",
      },
    })

    expect(result).toEqual({
      errors: ["Overall minimum must be between 0 and 100."],
      ok: false,
    })
  })
})
