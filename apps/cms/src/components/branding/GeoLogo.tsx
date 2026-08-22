import { GeoIcon } from "./GeoIcon"

export const GeoLogo = () => (
  <span
    style={{
      alignItems: "center",
      color: "var(--theme-text)",
      display: "inline-flex",
      fontFamily: "Arial, sans-serif",
      fontSize: "1.25rem",
      fontWeight: 800,
      gap: "0.55rem",
      letterSpacing: "-0.035em",
    }}
  >
    <GeoIcon size={30} />
    <span>Geo Foundry</span>
  </span>
)
