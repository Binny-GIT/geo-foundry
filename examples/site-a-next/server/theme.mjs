import { createElement } from "react"

export const siteATheme = Object.freeze({
  slots: {
    "after-hero": ({ payload }) =>
      createElement(
        "p",
        { "data-site-a-context": payload.pageType },
        "Verified technical editorial coverage.",
      ),
    footer: ({ payload }) =>
      createElement(
        "footer",
        { "data-site-a-footer": payload.pathname },
        "Site A · immutable release rendering",
      ),
    "page-header": ({ payload }) =>
      createElement("header", { "data-site-a-header": payload.pageId }, "Site A Engineering Notes"),
  },
  tokens: {
    accentColor: "#22d3ee",
    backgroundColor: "#07111f",
    borderColor: "#1f3b55",
    contentWidth: "76rem",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    foregroundColor: "#e6f5ff",
    mutedForegroundColor: "#9fb7cc",
    radius: "0.25rem",
    spacing: "1.25rem",
    surfaceColor: "#0d1b2a",
  },
})
