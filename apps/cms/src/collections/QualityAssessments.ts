import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { forceTenantFromSession } from "../access/tenant-field"

/**
 * Immutable quality evidence. Written by the content-service identity only
 * (see authorization matrix); every field is write-once by convention and
 * the workflow service verifies inputHash against the live edition body
 * before honoring any assessment.
 */
export const QualityAssessments = {
  slug: "quality-assessments",
  admin: {
    defaultColumns: ["state", "edition", "inputHash"],
    useAsTitle: "inputHash",
  },
  access: collectionAccess(CMS_RESOURCE.ASSESSMENTS),
  fields: [
    {
      name: "edition",
      type: "relationship",
      relationTo: "content-editions",
      required: true,
    },
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      required: true,
    },
    {
      name: "tenant",
      type: "relationship",
      relationTo: "tenants",
      required: true,
      hooks: {
        beforeValidate: [forceTenantFromSession],
      },
    },
    {
      name: "state",
      type: "select",
      options: ["pending", "running", "passed", "failed", "error"],
      required: true,
      defaultValue: "pending",
    },
    {
      name: "inputHash",
      type: "text",
      required: true,
    },
    {
      name: "issues",
      type: "json",
      required: true,
      defaultValue: [],
    },
    {
      name: "overall",
      type: "number",
    },
    {
      name: "dimensions",
      type: "json",
    },
    {
      name: "modelId",
      type: "text",
      required: true,
    },
    {
      name: "promptVersion",
      type: "text",
      required: true,
    },
    {
      name: "provider",
      type: "text",
      required: true,
    },
    {
      name: "thresholdsHash",
      type: "text",
      required: true,
    },
  ],
} satisfies CollectionConfig
