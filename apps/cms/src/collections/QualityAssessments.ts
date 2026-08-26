import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

/**
 * Immutable quality evidence. Written by the content-service identity only
 * (see authorization matrix); every field is write-once by convention and
 * the workflow service verifies inputHash against the live edition body
 * before honoring any assessment.
 */
export const QualityAssessments = {
  slug: "quality-assessments",
  labels: {
    plural: localized("Quality assessments", "质量评估"),
    singular: localized("Quality assessment", "质量评估"),
  },
  admin: {
    defaultColumns: ["state", "edition", "inputHash"],
    group: localized("Quality & Release", "质量与发布"),
    useAsTitle: "inputHash",
  },
  access: collectionAccess(CMS_RESOURCE.ASSESSMENTS),
  fields: localizedFields([
    {
      name: "edition",
      type: "relationship",
      relationTo: "content-editions",
      required: true,
      admin: {
        components: {
          Cell: "/components/fields/EditionCell#EditionCell",
        },
      },
    },
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      required: true,
    },
    tenantField(),
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
  ]),
} satisfies CollectionConfig
