import type { CollectionConfig } from "payload"

export const BootstrapAdmins = {
  slug: "bootstrap-admins",
  admin: {
    useAsTitle: "email",
  },
  auth: true,
  fields: [],
} satisfies CollectionConfig
