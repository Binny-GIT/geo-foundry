import { postgresAdapter } from "@payloadcms/db-postgres"
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant"
import { BlocksFeature, lexicalEditor } from "@payloadcms/richtext-lexical"
import { s3Storage } from "@payloadcms/storage-s3"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildConfig } from "payload"

import { ContentEditions } from "./collections/ContentEditions"
import { Contents } from "./collections/Contents"
import { Domains } from "./collections/Domains"
import { Media } from "./collections/Media"
import { Sites } from "./collections/Sites"
import { Tenants } from "./collections/Tenants"
import { Users } from "./collections/Users"
import { createPostgresAdapterOptions } from "./config/database"
import { parseCmsEnvironment } from "./config/environment"
import { PAGE_DOCUMENT_BLOCKS } from "./editor/page-document-blocks"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const environment = parseCmsEnvironment(process.env)

export default buildConfig({
  admin: {
    importMap: {
      baseDir: dirname,
    },
    user: Users.slug,
  },
  collections: [Tenants, Users, Sites, Domains, Contents, ContentEditions, Media],
  db: postgresAdapter(
    createPostgresAdapterOptions(environment, path.resolve(dirname, "migrations")),
  ),
  editor: lexicalEditor({
    features: ({ defaultFeatures }) => [
      ...defaultFeatures,
      BlocksFeature({ blocks: PAGE_DOCUMENT_BLOCKS }),
    ],
  }),
  plugins: [
    multiTenantPlugin({
      collections: {},
      enabled: false,
    }),
    s3Storage({
      bucket: environment.rustfs.bucket,
      collections: {
        [Media.slug]: {
          prefix: environment.rustfs.mediaPrefix,
        },
      },
      useCompositePrefixes: true,
      config: {
        credentials: {
          accessKeyId: environment.rustfs.accessKeyId,
          secretAccessKey: environment.rustfs.secretAccessKey,
        },
        endpoint: environment.rustfs.endpoint,
        forcePathStyle: environment.rustfs.forcePathStyle,
        region: environment.rustfs.region,
      },
      disableLocalStorage: true,
    }),
  ],
  secret: environment.payloadSecret,
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
})
