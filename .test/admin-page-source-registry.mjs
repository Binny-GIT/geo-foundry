/**
 * Admin route inventory for the public mk-dev UI loop.
 *
 * This registry is deliberately declarative: the runner uses it to distinguish
 * a correct empty state or an access restriction from an unexplained missing
 * data state, and it points a scenario back to its legal upstream creator.
 */

export const ADMIN_COLLECTIONS = [
  {
    slug: "users",
    title: "Users",
    source: "Tenant administrator creates tenant-scoped user accounts.",
    upstream: "/admin/collections/users/create",
    verify: ["/admin/collections/users", "/admin/collections/sites"],
    roles: ["super-admin", "tenant-admin"],
    emptyState: "No Results.",
  },
  {
    slug: "tenants",
    title: "Tenants",
    source: "Super-admin creates tenants before all tenant-scoped fixtures.",
    upstream: "/admin/collections/tenants/create",
    verify: ["/admin/collections/tenants", "/admin/collections/users"],
    roles: ["super-admin", "tenant-admin"],
    emptyState: "No Results.",
  },
  {
    slug: "sites",
    title: "Sites",
    source: "Tenant administrator creates sites from the site configuration form.",
    upstream: "/admin/collections/sites/create",
    verify: ["/admin", "/admin/collections/sites", "/admin/collections/domains"],
    roles: ["super-admin", "tenant-admin", "editor", "reviewer", "publisher", "content-service"],
    emptyState: "No Results.",
  },
  {
    slug: "domains",
    title: "Domains",
    source: "Tenant administrator creates canonical and alias domains for an existing site.",
    upstream: "/admin/collections/domains/create",
    verify: ["/admin", "/admin/collections/sites", "/admin/collections/domains"],
    roles: ["super-admin", "tenant-admin", "editor", "reviewer", "publisher"],
    emptyState: "No Results.",
  },
  {
    slug: "contents",
    title: "Contents",
    source: "Editor creates content within the session tenant.",
    upstream: "/admin/collections/contents/create",
    verify: ["/admin", "/admin/collections/contents", "/admin/collections/content-editions"],
    roles: ["super-admin", "tenant-admin", "editor", "reviewer", "publisher", "content-service"],
    emptyState: "No Results.",
  },
  {
    slug: "content-editions",
    title: "Content Editions",
    source: "Editor creates an edition after Content and Site exist; workflow transitions use the dedicated endpoint.",
    upstream: "/admin/collections/content-editions/create",
    verify: [
      "/admin",
      "/admin/collections/content-editions",
      "/admin/collections/sites",
      "/admin/collections/quality-assessments",
    ],
    roles: ["super-admin", "tenant-admin", "editor", "reviewer", "publisher", "content-service"],
    emptyState: "No Results.",
  },
  {
    slug: "media",
    title: "Media",
    source: "Editor uploads a run-namespaced file through the browser upload form.",
    upstream: "/admin/collections/media/create",
    verify: ["/admin/collections/media", "/admin/collections/content-editions"],
    roles: ["super-admin", "tenant-admin", "editor", "reviewer", "publisher"],
    emptyState: "No Results.",
  },
  {
    slug: "url-records",
    title: "URL Records",
    source: "URL registry service reserves and activates records; editor or publisher may use the rename endpoint.",
    upstream: "content-service URL registry workflow",
    verify: ["/admin/collections/url-records", "/admin/collections/content-editions"],
    roles: ["super-admin", "tenant-admin", "editor", "publisher"],
    emptyState: "No Results.",
  },
  {
    slug: "quality-assessments",
    title: "Quality Assessments",
    source: "Content-service records immutable evidence using its guarded internal endpoint.",
    upstream: "content-service assessment workflow",
    verify: ["/admin", "/admin/collections/quality-assessments", "/admin/collections/content-editions"],
    roles: ["super-admin", "tenant-admin", "editor", "reviewer", "publisher", "content-service"],
    emptyState: "No Results.",
  },
  {
    slug: "releases",
    title: "Releases",
    source: "Content-service records a publish receipt after a publisher completes the legal workflow transition.",
    upstream: "content-service publish-receipt workflow",
    verify: ["/admin", "/admin/collections/releases", "/admin/collections/sites"],
    roles: ["super-admin", "tenant-admin", "publisher"],
    emptyState: "No Results.",
  },
  {
    slug: "rollback-intents",
    title: "Rollback Intents",
    source: "Publisher creates an intent through the rollback endpoint after two legal releases exist.",
    upstream: "publisher rollback intent workflow",
    verify: ["/admin", "/admin/collections/rollback-intents", "/admin/collections/releases"],
    roles: ["super-admin", "tenant-admin", "publisher"],
    emptyState: "No Results.",
  },
  {
    slug: "operations",
    title: "Operations",
    source: "Content-service creates and advances durable operations using guarded internal endpoints.",
    upstream: "content-service operation ledger workflow",
    verify: ["/admin", "/admin/collections/operations"],
    roles: ["super-admin", "tenant-admin", "editor", "publisher"],
    emptyState: "No Results.",
  },
]

export const SERVICE_OWNED_404 = [
  {
    slug: "outbox-events",
    route: "/admin/collections/outbox-events",
    reason: "The durable outbox is service-owned and read is denied to every human role.",
  },
  {
    slug: "idempotency-records",
    route: "/admin/collections/idempotency-records",
    reason: "Idempotency storage is service-owned and read is denied to every human role.",
  },
]

export const PUBLIC_PAGES = [
  {
    id: "public-home",
    route: "/",
    expected: { heading: "Content operations workspace", status: 200 },
    upstream: "Static public application route.",
  },
  {
    id: "admin-login",
    route: "/admin/login",
    expected: { status: 200, text: "Content operations" },
    upstream: "Payload authentication route.",
  },
  {
    id: "admin-forgot-password",
    route: "/admin/forgot",
    expected: { status: 200 },
    upstream: "Payload authentication route; do not submit shared-account resets.",
  },
  {
    id: "public-not-found",
    route: "/definitely-not-a-page",
    expected: { status: 404 },
    upstream: "Public application not-found boundary.",
  },
  {
    id: "admin-invalid-route",
    route: "/admin/definitely-not-a-page",
    // Anonymous Payload/Next streaming may settle on Login or a minimal
    // Not Found shell. The authenticated runner separately verifies the full
    // `Nothing found` boundary; here we assert that no collection navigation leaks.
    expected: { absentText: "COLLECTIONS", status: 200 },
    upstream: "Payload authentication guard before the admin not-found boundary.",
  },
]

export const collectionBySlug = (slug) =>
  ADMIN_COLLECTIONS.find((collection) => collection.slug === slug) ?? null

export const collectionRoute = (slug) => `/admin/collections/${slug}`

export const collectionApiRoute = (slug) => `/api/${slug}`

export const pageVerdict = ({ rendering, data, rbac }) => ({
  rendering,
  data,
  overall:
    rendering === "PASS" &&
    rbac !== "FAIL" &&
    rbac !== "BLOCKED" &&
    ["PASS", "EXPECTED_EMPTY", "RESTRICTED", "NOT_APPLICABLE"].includes(data)
      ? "PASS_FULL"
      : rendering === "BLOCKED" || rbac === "BLOCKED"
        ? "BLOCKED"
        : "FAILED",
  rbac,
})
