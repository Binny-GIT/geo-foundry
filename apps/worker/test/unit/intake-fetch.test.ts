import { describe, expect, it } from "vitest"

import { extractRssEntries, extractStructuredArticle } from "../../src/intake/extract.js"
import { isPublicAddress, pinnedLookupResult } from "../../src/intake/safe-fetch.js"
import { snapshotStorageKeyOf } from "../../src/intake/snapshot-store.js"

describe("intake SSRF boundaries", () => {
  it("rejects loopback, private, metadata, and multicast addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.100.100.200",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
    expect(isPublicAddress("8.8.8.8")).toBe(true)
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true)
  })
})

describe("intake pinned DNS lookup", () => {
  it("returns the Node all-address shape without releasing the verified address", () => {
    const resolved = { address: "8.8.8.8", family: 4 as const }
    expect(pinnedLookupResult(resolved, false)).toEqual(resolved)
    expect(pinnedLookupResult(resolved, true)).toEqual([resolved])
  })
})

describe("intake extraction", () => {
  it("extracts structured blocks, summary, and title from article HTML", () => {
    const page = extractStructuredArticle(
      `<html><head><title>Article title</title><meta name="description" content="Meta summary"/>
      <script>secret()</script></head><body><article>
      <h1>Top heading</h1><p>This paragraph is long enough to serve as a summary fallback.</p>
      <ul><li>First point</li><li>Second point</li></ul>
      <img src="/img/hero.png" alt="Hero"/>
      <pre><code>console.log(1)</code></pre>
      <style>.hidden{}</style>
      </article></body></html>`,
      "https://source.test/post/1",
    )
    expect(page.title).toBe("Article title")
    expect(page.blocks).toEqual([
      { blockType: "heading", level: "2", text: "Top heading" },
      { blockType: "paragraph", text: "This paragraph is long enough to serve as a summary fallback." },
      { blockType: "list", items: [{ text: "First point" }, { text: "Second point" }], style: "unordered" },
      { alt: "Hero", blockType: "image", src: "https://source.test/img/hero.png" },
      { blockType: "code", code: "console.log(1)", language: "text" },
    ])
  })

  it("falls back to the first paragraph when no meta description exists", () => {
    const page = extractStructuredArticle(
      "<html><head><title>T</title></head><body><main><p>This paragraph is long enough to become the fallback summary for the page.</p></main></body></html>",
      "https://source.test/x",
    )
    expect(page.summary).toContain("fallback summary")
  })

  it("parses RSS and Atom links into bounded URL intake entries", () => {
    expect(
      extractRssEntries(
        "<rss><channel><item><title>One</title><link>https://source.test/one</link><description>First source</description></item></channel></rss>",
      ),
    ).toEqual([
      { sourceUrl: "https://source.test/one", summary: "First source", title: "One" },
    ])
    expect(
      extractRssEntries(
        "<feed><entry><title>Two</title><link href=\"https://source.test/two\"/><summary>Second source</summary></entry></feed>",
      ),
    ).toEqual([
      { sourceUrl: "https://source.test/two", summary: "Second source", title: "Two" },
    ])
  })
})

describe("intake snapshot identity", () => {
  it("derives deterministic keys from tenant, intake item, kind, and bytes hash", () => {
    const options = {
      accessKeyId: "key",
      bucket: "geo-foundry",
      endpointHost: "127.0.0.1",
      endpointPort: 9000,
      keyPrefix: "objects",
      secretAccessKey: "secret",
      useSSL: false,
    }
    const hash = "a".repeat(64)
    expect(snapshotStorageKeyOf(options, 7, 42, "raw-response", hash)).toBe(
      `objects/source-snapshots/7/42/raw-response-${hash}.bin`,
    )
    expect(snapshotStorageKeyOf(options, 7, 42, "extracted-content", hash)).toBe(
      `objects/source-snapshots/7/42/extracted-content-${hash}.txt`,
    )
  })
})
