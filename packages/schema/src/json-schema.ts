import { z } from "zod"

import { PageDocumentSchema } from "./page-document/v1/index.js"

const generatedPageDocumentJsonSchema = z.toJSONSchema(PageDocumentSchema, {
  target: "draft-2020-12",
  io: "output",
  reused: "ref",
})

export const PageDocumentJsonSchema = {
  $id: "https://schemas.geo-foundry.dev/page-document/v1",
  ...generatedPageDocumentJsonSchema,
}
