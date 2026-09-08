import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { CMS_ACTION, decideAccess } from "../../src/access/policy"
import { CMS_ROLE, type CmsRole } from "../../src/access/roles"
import {
  CONSOLE_NAV,
  CONSOLE_RESOURCES,
  VISIBLE_RESOURCE_SLUGS,
} from "../../src/console/lib/resources"

const root = resolve(import.meta.dirname, "../..")

const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

const claimsOf = (role: CmsRole) => ({ kind: "user" as const, role, tenantId: 1, userId: "1" })

/** Mirrors the authenticated layout: nav-visible slugs are READ-allowed ones. */
const navVisibleSlugs = (role: CmsRole) =>
  VISIBLE_RESOURCE_SLUGS.filter((slug) => {
    const resource = CONSOLE_RESOURCES[slug].resource
    return resource !== null && decideAccess(claimsOf(role), resource, CMS_ACTION.READ)
  })

describe("console tenant nav and account settings contract", () => {
  it("lists tenants directly above user management in the admin nav group", async () => {
    const resources = await sourceOf("src/console/lib/resources.ts")

    const adminSlugs = CONSOLE_NAV.admin.flatMap((item) =>
      item.kind === "resource" ? [item.slug] : [],
    )
    expect(adminSlugs.indexOf("tenants")).toBe(0)
    expect(adminSlugs.indexOf("users")).toBe(1)
    // The tenant glyph is its own building, not a recycled users icon.
    expect(resources).toContain("icon: BuildingIcon")
  })

  it("only super-admin and tenant-admin can read tenants, so the nav entry is role-gated", () => {
    for (const role of Object.values(CMS_ROLE)) {
      const visible = navVisibleSlugs(role)
      const seesTenants = visible.includes("tenants")
      const seesUsers = visible.includes("users")
      expect(seesTenants).toBe(role === CMS_ROLE.SUPER_ADMIN || role === CMS_ROLE.TENANT_ADMIN)
      expect(seesUsers).toBe(role === CMS_ROLE.SUPER_ADMIN || role === CMS_ROLE.TENANT_ADMIN)
    }

    // Editor keeps the operational pipeline but never the admin group entries.
    const editorVisible = navVisibleSlugs(CMS_ROLE.EDITOR)
    expect(editorVisible).toContain("content-editions")
    expect(editorVisible).toContain("sites")
    expect(editorVisible).not.toContain("users")
    expect(editorVisible).not.toContain("tenants")
  })

  it("splits the header dropdown into profile and password deep-links", async () => {
    const shell = await sourceOf("src/console/components/ConsoleShell.tsx")

    expect(shell).toContain(["$", "{consoleRoute.account}", "?tab=password"].join(""))
    expect(shell).toContain("个人资料")
    expect(shell).not.toContain("账户设置（修改密码）")
    expect(shell).toContain("KeyRoundIcon")
  })

  it("serves the account page as profile/password tabs seeded from ?tab=password", async () => {
    const [page, tabs] = await Promise.all([
      sourceOf("src/app/(console)/admin/(authenticated)/account/page.tsx"),
      sourceOf("src/console/components/ConsoleAccountTabs.tsx"),
    ])

    expect(page).toContain("searchParams")
    expect(page).toContain('tabParam === "password"')
    expect(page).toContain("ConsoleAccountTabs")
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('next === "profile" ? "/admin/account" : "/admin/account?tab=password"')
    expect(tabs).toContain("ConsolePasswordForm")
  })

  it("wires the password form to the self-service endpoint with server-side validation copy", async () => {
    const form = await sourceOf("src/console/components/ConsolePasswordForm.tsx")

    expect(form).toContain('"/api/account/password"')
    expect(form).toContain("currentPassword")
    expect(form).toContain("ACCOUNT_PASSWORD_CURRENT_INVALID")
    expect(form).toContain("minLength={8}")
    expect(form).toContain("next !== confirm")
    // The button submits through the form (Enter works too), stays clickable
    // during validation, and reads DOM values so autofill cannot strand it.
    expect(form).toContain('type="submit"')
    expect(form).toContain("disabled={pending}")
    expect(form).toContain("instanceof HTMLInputElement")
  })

  it("changes the password through compat auth without invalidating the current session", async () => {
    const [authRoute, gateway] = await Promise.all([
      sourceOf("src/server/routes/auth.ts"),
      sourceOf("src/app/(api)/api/[...slug]/route.ts"),
    ])

    expect(gateway).toContain("handleAccountAuthPost")
    expect(authRoute).toContain('slug[0] === "account" && slug[1] === "password"')
    expect(authRoute).toContain("authenticateRequest(request.headers)")
    expect(authRoute).toContain("verifyPasswordCompat")
    expect(authRoute).toContain("generatePasswordCredentialsCompat")
    expect(authRoute).toContain("updatePasswordHash")
    expect(authRoute).toContain("ACCOUNT_PASSWORD_CURRENT_INVALID")
    expect(authRoute).toContain("ACCOUNT_PASSWORD_ROLE_FORBIDDEN")
    expect(authRoute).toContain("newPassword: z.string().min(8)")
    expect(authRoute).not.toContain("req.payload.login")
  })
})
