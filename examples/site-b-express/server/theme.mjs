import { createElement } from "react"

/** Site B operations/business theme: warm amber on slate, report-style layout. */
export const siteBTheme = Object.freeze({
  slots: {
    "after-hero": ({ payload }) =>
      createElement(
        "p",
        { "data-site-b-context": payload.pageType },
        "Operations briefing with verified release data.",
      ),
    footer: ({ payload }) =>
      createElement("footer", { "data-site-b-footer": payload.pathname }, "Site B Operations Desk"),
    "page-header": ({ payload }) =>
      createElement("header", { "data-site-b-header": payload.pageId }, "Site B Operations Review"),
  },
  tokens: {
    accentColor: "#f59e0b",
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    contentWidth: "68rem",
    fontFamily: "Source Sans 3, Segoe UI, system-ui, sans-serif",
    foregroundColor: "#0f172a",
    mutedForegroundColor: "#475569",
    radius: "0.5rem",
    spacing: "1rem",
    surfaceColor: "#ffffff",
  },
})
