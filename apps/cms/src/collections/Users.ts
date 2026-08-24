import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from "payload"

import { claimsFromRequest, collectionAccess } from "../access/functions"
import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../access/policy"
import { forceRoleFromSession } from "../access/role-field"
import { CMS_ROLES } from "../access/roles"
import { validateUserTenantInvariant } from "../access/user-tenant-invariant"
import { tenantField } from "./shared/tenant-field"

const assertUserTenantInvariant: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const result = validateUserTenantInvariant({
    existingRole: originalDoc?.["role"],
    existingTenant: originalDoc?.["tenant"],
    incomingRole: data["role"],
    incomingTenant: data["tenant"],
  })
  if (result !== true) {
    throw new APIError("CMS_USER_TENANT_REQUIRED", 400)
  }
  return data
}

export const Users = {
  slug: "users",
  admin: {
    defaultColumns: ["email", "role", "tenant", "updatedAt"],
    group: "Access",
    useAsTitle: "email",
  },
  auth: {
    useAPIKey: true,
  },
  hooks: {
    beforeChange: [assertUserTenantInvariant],
  },
  access: {
    ...collectionAccess(CMS_RESOURCE.USERS),
    create: async ({ req }) => {
      if (decideAccess(claimsFromRequest(req), CMS_RESOURCE.USERS, CMS_ACTION.CREATE)) {
        return true
      }
      // First-user bootstrap: exactly one anonymous create on an empty
      // collection mints the initial super-admin; every later anonymous
      // create is denied (deny-by-default).
      if (req.user === null || req.user === undefined) {
        if (req.payload === undefined) {
          return false
        }
        const counted = await req.payload.count({ collection: "users" })
        return counted.totalDocs === 0
      }
      return false
    },
  },
  fields: [
    {
      name: "role",
      type: "select",
      required: true,
      options: [...CMS_ROLES],
      hooks: {
        beforeValidate: [forceRoleFromSession],
      },
    },
    tenantField({ required: false }),
  ],
} satisfies CollectionConfig
