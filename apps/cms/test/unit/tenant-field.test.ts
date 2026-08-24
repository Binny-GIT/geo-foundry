import { describe, expect, it } from "vitest"

import { CMS_ROLE } from "../../src/access/roles"
import { ContentEditions } from "../../src/collections/ContentEditions"
import { QualityAssessments } from "../../src/collections/QualityAssessments"
import { Releases } from "../../src/collections/Releases"
import { RollbackIntents } from "../../src/collections/RollbackIntents"
import { Sites } from "../../src/collections/Sites"
import { Tenants } from "../../src/collections/Tenants"
import { Users } from "../../src/collections/Users"
import { tenantField } from "../../src/collections/shared/tenant-field"
import {
  editionHrefOf,
  editionReferenceOf,
} from "../../src/components/fields/edition-cell-model"
import { siteHrefOf, siteReferenceOf } from "../../src/components/fields/site-cell-model"
import { tenantHrefOf, tenantReferenceOf } from "../../src/components/fields/tenant-cell-model"

describe("tenantField", () => {
  it("Given a tenant-bound user, when admin visibility is evaluated, then the server-managed tenant field is hidden", () => {
    const field = tenantField()
    expect(field.admin?.condition?.({}, {}, { user: { role: CMS_ROLE.EDITOR } } as never)).toBe(
      false,
    )
  })

  it("Given a super-admin, when admin visibility is evaluated, then the tenant selector remains available", () => {
    const field = tenantField()
    expect(
      field.admin?.condition?.({}, {}, { user: { role: CMS_ROLE.SUPER_ADMIN } } as never),
    ).toBe(true)
  })

  it("Given collection-specific options, when the field is built, then index, required, and server binding stay explicit", () => {
    const field = tenantField({ index: true, managed: false, required: false })
    expect(field.index).toBe(true)
    expect(field.required).toBeUndefined()
    expect(field.hooks).toBeUndefined()
    expect(field.admin?.components?.Cell).toBe("/components/fields/TenantCell#TenantCell")
  })

  it("Given a Site relationship cell, when a populated or scalar reference is displayed, then it preserves the real Site identity", () => {
    expect(siteReferenceOf({ id: 374, name: "Embed Site A" })).toEqual({
      id: 374,
      name: "Embed Site A",
    })
    expect(siteReferenceOf(374)).toEqual({ id: 374, name: null })
    expect(siteReferenceOf(null)).toEqual({ id: null, name: null })
    expect(siteReferenceOf({ id: 374, name: "" })).toEqual({ id: 374, name: null })
    expect(siteHrefOf(374)).toBe("/admin/collections/sites/374")
  })

  it("Given Content Editions list columns, when a Site relationship is rendered, then it uses the resilient Site cell", () => {
    const site = ContentEditions.fields.find((field) => field.name === "site")
    expect(site).toMatchObject({
      admin: { components: { Cell: "/components/fields/SiteCell#SiteCell" } },
    })
  })

  it("Given Releases list columns, when a Site relationship is rendered, then it uses the resilient Site cell", () => {
    const site = Releases.fields.find((field) => field.name === "site")
    expect(site).toMatchObject({
      admin: { components: { Cell: "/components/fields/SiteCell#SiteCell" } },
    })
  })

  it("Given Rollback Intents list columns, when a Site relationship is rendered, then it uses the resilient Site cell", () => {
    const site = RollbackIntents.fields.find((field) => field.name === "site")
    expect(site).toMatchObject({
      admin: { components: { Cell: "/components/fields/SiteCell#SiteCell" } },
    })
  })

  it("Given a Quality Assessment Edition relationship, when rendered from a scalar ID, then its true title can be resolved without losing the detail link", () => {
    expect(editionReferenceOf({ id: 542, title: "UI Loop Edition" })).toEqual({
      id: 542,
      title: "UI Loop Edition",
    })
    expect(editionReferenceOf(542)).toEqual({ id: 542, title: null })
    expect(editionReferenceOf(null)).toEqual({ id: null, title: null })
    expect(editionHrefOf(542)).toBe("/admin/collections/content-editions/542")

    const edition = QualityAssessments.fields.find((field) => field.name === "edition")
    expect(edition).toMatchObject({
      admin: { components: { Cell: "/components/fields/EditionCell#EditionCell" } },
    })
  })

  it("Given the Sites collection, when its admin configuration is inspected, then the operational workspace augments rather than replaces the list", () => {
    expect(Sites.admin?.components?.beforeList).toEqual([
      "/components/sites/SitesOperationsWorkspace#SitesOperationsWorkspace",
    ])
    expect(Sites.admin?.defaultColumns).toEqual([
      "name",
      "status",
      "locale",
      "timezone",
      "tenant",
      "updatedAt",
    ])
  })

  it("Given a Tenant relationship cell, when a populated or scalar reference is displayed, then it preserves the real Tenant identity", () => {
    expect(tenantReferenceOf({ id: 413, name: "UI Loop Tenant" })).toEqual({
      id: 413,
      name: "UI Loop Tenant",
    })
    expect(tenantReferenceOf(413)).toEqual({ id: 413, name: null })
    expect(tenantReferenceOf(null)).toEqual({ id: null, name: null })
    expect(tenantReferenceOf({ id: 413, name: "" })).toEqual({ id: 413, name: null })
    expect(tenantHrefOf(413)).toBe("/admin/collections/tenants/413")
  })

  it("Given the Tenants and Users list views, when their admin configuration is inspected, then rows are scannable without opening every document", () => {
    expect(Tenants.admin?.defaultColumns).toEqual(["name", "updatedAt"])
    expect(Users.admin?.defaultColumns).toEqual(["email", "role", "tenant", "updatedAt"])
  })

  it("Given the Rollback Intents list, when its title is derived, then it uses the human-readable intent id instead of the document id", () => {
    expect(RollbackIntents.admin?.useAsTitle).toBe("intentId")
  })
})
