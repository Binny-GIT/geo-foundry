export const LoginIntro = () => (
  <div
    style={{
      borderBottom: "1px solid var(--theme-elevation-150)",
      marginBottom: "1.5rem",
      paddingBottom: "1.25rem",
    }}
  >
    <p
      style={{
        color: "#2563eb",
        fontSize: "0.72rem",
        fontWeight: 800,
        letterSpacing: "0.12em",
        margin: "0 0 0.4rem",
      }}
    >
      GEO FOUNDRY
    </p>
    <h1
      style={{
        color: "var(--theme-text)",
        fontSize: "1.6rem",
        letterSpacing: "-0.03em",
        lineHeight: 1.15,
        margin: 0,
      }}
    >
      Content operations
    </h1>
    <p style={{ color: "var(--theme-elevation-600)", lineHeight: 1.45, margin: "0.6rem 0 0" }}>
      Sign in to manage content, publishing, and delivery operations.
    </p>
  </div>
)
