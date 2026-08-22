export const metadata = {
  description: "Geo Foundry content management workspace",
  title: "Geo Foundry",
}

const RootPage = () => (
  <main
    style={{
      alignItems: "center",
      background: "linear-gradient(135deg, #eff6ff 0%, #f8fafc 52%, #ecfdf5 100%)",
      color: "#0f172a",
      display: "flex",
      fontFamily: "Arial, sans-serif",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "2rem",
    }}
  >
    <section
      style={{
        background: "#ffffff",
        border: "1px solid #cbd5e1",
        borderRadius: "1rem",
        boxShadow: "0 20px 50px rgb(15 23 42 / 12%)",
        maxWidth: "42rem",
        padding: "3rem",
        width: "100%",
      }}
    >
      <p
        style={{
          color: "#2563eb",
          fontSize: "0.875rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          margin: 0,
        }}
      >
        GEO FOUNDRY
      </p>
      <h1 style={{ fontSize: "2.25rem", lineHeight: 1.15, margin: "1rem 0" }}>
        Content operations workspace
      </h1>
      <p style={{ color: "#475569", fontSize: "1.125rem", lineHeight: 1.6, margin: 0 }}>
        Manage content editions, publishing workflows, and delivery artifacts from the Geo Foundry
        administration console.
      </p>
      <a
        href="/admin"
        style={{
          background: "#2563eb",
          borderRadius: "0.5rem",
          color: "#ffffff",
          display: "inline-block",
          fontWeight: 700,
          marginTop: "2rem",
          padding: "0.75rem 1.125rem",
          textDecoration: "none",
        }}
      >
        Open administration
      </a>
    </section>
  </main>
)

export default RootPage
