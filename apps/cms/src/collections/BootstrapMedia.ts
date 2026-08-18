import type { CollectionConfig } from "payload"

export const BootstrapMedia = {
  slug: "bootstrap-media",
  fields: [
    {
      name: "alt",
      type: "text",
      required: true,
    },
  ],
  upload: true,
} satisfies CollectionConfig
