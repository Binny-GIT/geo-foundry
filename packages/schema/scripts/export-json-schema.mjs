import { writeFile } from "node:fs/promises"

import { PageDocumentJsonSchema } from "../dist/json-schema.js"

const outputUrl = new URL("../dist/page-document.schema.json", import.meta.url)
const serializedSchema = `${JSON.stringify(PageDocumentJsonSchema)}\n`

await writeFile(outputUrl, serializedSchema, "utf8")
