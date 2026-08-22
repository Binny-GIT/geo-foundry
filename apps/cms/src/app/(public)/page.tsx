export const metadata = {
  description: "Geo Foundry content management workspace",
  title: "Geo Foundry",
}

const FEATURES = [
  {
    description:
      "Staged brief → outline → draft → site adaptation with full version history and role separation.",
    emoji: "✍️",
    title: "Content pipeline",
  },
  {
    description:
      "Deterministic, semantic, and LLM evaluation gate every edition before it can compile or publish.",
    emoji: "🛡️",
    title: "Quality gates",
  },
  {
    description:
      "Immutable release artifacts with verified manifests, atomic current pointer, and one-click rollback.",
    emoji: "📦",
    title: "Immutable releases",
  },
] as const

const RootPage = () => (
  <main
    style={{
      background: "linear-gradient(160deg, #eff6ff 0%, #f8fafc 55%, #ecfdf5 100%)",
      color: "#0f172a",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: "Arial, sans-serif",
      minHeight: "100vh",
      padding: "4rem 1.5rem 3rem",
    }}
  >
    <section style={{ maxWidth: "56rem", width: "100%" }}>
      <p
        style={{
          alignItems: "center",
          color: "#2563eb",
          display: "flex",
          fontSize: "0.8rem",
          fontWeight: 800,
          gap: "0.5rem",
          letterSpacing: "0.14em",
          margin: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            background: "#2563eb",
            borderRadius: "0.375rem",
            color: "#ffffff",
            display: "inline-flex",
            fontSize: "0.7rem",
            fontWeight: 800,
            justifyContent: "center",
            height: "1.5rem",
            letterSpacing: 0,
            width: "1.5rem",
          }}
        >
          GF
        </span>
        GEO FOUNDRY
      </p>
      <h1
        style={{
          fontSize: "3rem",
          letterSpacing: "-0.04em",
          lineHeight: 1.08,
          margin: "1.25rem 0 0",
        }}
      >
        Content operations workspace
      </h1>
      <p
        style={{
          color: "#475569",
          fontSize: "1.15rem",
          lineHeight: 1.65,
          margin: "1.25rem 0 0",
          maxWidth: "40rem",
        }}
      >
        Governed multi-site content production: manage content editions, publishing workflows, and
        delivery artifacts from the Geo Foundry administration console.
      </p>
      <a
        href="/admin"
        style={{
          background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
          borderRadius: "0.625rem",
          boxShadow: "0 10px 24px rgb(37 99 235 / 35%)",
          color: "#ffffff",
          display: "inline-block",
          fontWeight: 700,
          marginTop: "2rem",
          padding: "0.85rem 1.4rem",
          textDecoration: "none",
        }}
      >
        Open administration →
      </a>

      <div
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          marginTop: "3.5rem",
        }}
      >
        {FEATURES.map((feature) => (
          <article
            key={feature.title}
            style={{
              background: "rgb(255 255 255 / 75%)",
              border: "1px solid #dbe3ee",
              borderRadius: "0.875rem",
              padding: "1.4rem 1.5rem",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: "1.6rem" }}>
              {feature.emoji}
            </span>
            <h2
              style={{ fontSize: "1.05rem", letterSpacing: "-0.01em", margin: "0.7rem 0 0.45rem" }}
            >
              {feature.title}
            </h2>
            <p style={{ color: "#526071", fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>
              {feature.description}
            </p>
          </article>
        ))}
      </div>

      <p style={{ color: "#94a3b8", fontSize: "0.8rem", margin: "3.5rem 0 0" }}>
        Control plane for tenants, editions, and release audit — published sites keep serving even
        when this console is offline.
      </p>
    </section>
  </main>
)

export default RootPage
