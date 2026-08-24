import { GeoIcon } from "./GeoIcon"

export const GeoLogo = () => (
  <span
    style={{
      alignItems: "center",
      color: "var(--theme-text, #10213e)",
      display: "inline-flex",
      fontFamily:
        'var(--gf-font-body, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
      fontSize: "18px",
      fontWeight: 750,
      gap: "0.5rem",
      letterSpacing: "-0.03em",
      lineHeight: 1.25,
    }}
  >
    <GeoIcon size={28} />
    <span>Geo Foundry</span>
  </span>
)
