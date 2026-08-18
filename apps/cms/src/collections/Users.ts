import type { CollectionConfig } from "payload"

import { collectionAccess, claimsFromRequest } from "../access/functions"
import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../access/policy"
import { CMS_ROLES } from "../access/roles"
import { forceRoleFromSession } from "../access/role-field"
import { forceTenantFromSession } from "../access/tenant-field"

export const Users = {
  slug: "users",
  admin: {
    useAsTitle: "email",
  },
  auth: {
    useAPIKey: true,
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
    {
      name: "tenant",
      type: "relationship",
      relationTo: "tenants",
      hooks: {
        beforeValidate: [forceTenantFromSession],
      },
    },
  ],
} satisfies CollectionConfig
