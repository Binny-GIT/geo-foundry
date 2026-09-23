import { articlePageFixture, type PageDocument, redirectPageFixture } from "@geo/schema"
import { describe, expect, it } from "vitest"

import { absoluteAssetUrlOf, absolutizePageDocumentMedia } from "../../src/render/absolute-media.js"

const MEDIA_BASE_URL = "https://geo-delivery.test/v1/sites/site-a.test/media"

describe("absoluteAssetUrlOf", () => {
  it("leaves external https URLs untouched", () => {
    expect(absoluteAssetUrlOf("https://media.site-a.test/overview.mp4", MEDIA_BASE_URL)).toBe(
      "https://media.site-a.test/overview.mp4",
    )
  })

  it("rewrites a /media/<filename> site-relative reference to the delivery media URL", () => {
    expect(absoluteAssetUrlOf("/media/map.webp", MEDIA_BASE_URL)).toBe(`${MEDIA_BASE_URL}/map.webp`)
  })

  it("percent-encodes the filename it rewrites", () => {
    expect(absoluteAssetUrlOf("/media/a b.png", MEDIA_BASE_URL)).toBe(`${MEDIA_BASE_URL}/a%20b.png`)
  })

  it("passes through anything that is neither absolute nor a /media/ reference", () => {
    expect(absoluteAssetUrlOf("/uploads/legacy.png", MEDIA_BASE_URL)).toBe("/uploads/legacy.png")
  })
})

describe("absolutizePageDocumentMedia", () => {
  it("rewrites the body image block's src and leaves the external video src alone while rewriting its poster", () => {
    const rewritten = absolutizePageDocumentMedia(articlePageFixture, MEDIA_BASE_URL)
    if (rewritten.pageType !== "article") throw new Error("expected article page")

    const imageBlock = rewritten.body.find((block) => block.type === "image")
    expect(imageBlock?.src).toBe(`${MEDIA_BASE_URL}/map.webp`)

    const videoBlock = rewritten.body.find((block) => block.type === "video")
    expect(videoBlock?.src).toBe("https://media.site-a.test/overview.mp4")
    expect(videoBlock?.poster).toBe(`${MEDIA_BASE_URL}/overview.webp`)
  })

  it("rewrites hero.image.src when present", () => {
    const withHeroImage: PageDocument = {
      ...articlePageFixture,
      hero: { image: { alt: "Hero", src: "/media/hero.png" }, title: "Geo Foundry" },
    }
    const rewritten = absolutizePageDocumentMedia(withHeroImage, MEDIA_BASE_URL)
    if (rewritten.pageType !== "article") throw new Error("expected article page")
    expect(rewritten.hero?.image?.src).toBe(`${MEDIA_BASE_URL}/hero.png`)
  })

  it("rewrites openGraph/twitter images inside seo for every page type, including redirect pages", () => {
    const withOgImage = {
      ...redirectPageFixture,
      seo: {
        ...redirectPageFixture.seo,
        openGraph: { description: "d", image: "/media/og.png", title: "t", type: "website" as const },
      },
    }
    const rewritten = absolutizePageDocumentMedia(withOgImage, MEDIA_BASE_URL)
    expect(rewritten.seo.openGraph?.image).toBe(`${MEDIA_BASE_URL}/og.png`)
  })

  it("does not mutate the input document", () => {
    const before = JSON.stringify(articlePageFixture)
    absolutizePageDocumentMedia(articlePageFixture, MEDIA_BASE_URL)
    expect(JSON.stringify(articlePageFixture)).toBe(before)
  })
})
