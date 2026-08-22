import { GeoIcon } from "./GeoIcon"

export const LoginIntro = () => (
  <div
    style={{
      borderBottom: "1px solid var(--theme-elevation-150)",
      marginBottom: "1.75rem",
      paddingBottom: "1.5rem",
    }}
  >
    <span
      style={{
        alignItems: "center",
        display: "inline-flex",
        gap: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      <GeoIcon size={34} />
      <span
        style={{
          color: "var(--theme-text)",
          fontFamily: "Arial, sans-serif",
          fontSize: "1.15rem",
          fontWeight: 800,
          letterSpacing: "-0.03em",
        }}
      >
        Geo Foundry
      </span>
    </span>
    <h1
      style={{
        color: "var(--theme-text)",
        fontSize: "1.7rem",
        letterSpacing: "-0.03em",
        lineHeight: 1.15,
        margin: 0,
      }}
    >
      Content operations
    </h1>
    <p
      style={{
        color: "var(--theme-elevation-600)",
        lineHeight: 1.5,
        margin: "0.6rem 0 0",
      }}
    >
      Sign in to manage content editions, quality review, publishing, and delivery.
    </p>
  </div>
)
