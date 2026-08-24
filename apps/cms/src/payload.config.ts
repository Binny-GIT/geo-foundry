import path from "node:path"
import { fileURLToPath } from "node:url"
import { postgresAdapter } from "@payloadcms/db-postgres"
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant"
import { BlocksFeature, lexicalEditor } from "@payloadcms/richtext-lexical"
import { s3Storage } from "@payloadcms/storage-s3"
import { enTranslations } from "@payloadcms/translations/languages/en"
import { zhTranslations } from "@payloadcms/translations/languages/zh"
import { buildConfig } from "payload"

import { ContentEditions } from "./collections/ContentEditions"
import { Contents } from "./collections/Contents"
import { Domains } from "./collections/Domains"
import { IdempotencyRecords } from "./collections/IdempotencyRecords"
import { Media } from "./collections/Media"
import { Operations } from "./collections/Operations"
import { OutboxEvents } from "./collections/OutboxEvents"
import { QualityAssessments } from "./collections/QualityAssessments"
import { Releases } from "./collections/Releases"
import { RollbackIntents } from "./collections/RollbackIntents"
import { Sites } from "./collections/Sites"
import { Tenants } from "./collections/Tenants"
import { UrlRecords } from "./collections/UrlRecords"
import { Users } from "./collections/Users"
import { createPostgresAdapterOptions } from "./config/database"
import { parseCmsEnvironment } from "./config/environment"
import { PAGE_DOCUMENT_BLOCKS } from "./editor/page-document-blocks"
import {
  createDraftFromPublishedEndpoint,
  submitPublishOperationEndpoint,
  transitionEditionEndpoint,
} from "./endpoints/edition-workflow"
import { allInternalEndpoints } from "./endpoints/internal/index"
import { createRollbackIntentEndpoint } from "./endpoints/rollback-intents"
import { renameUrlRecordEndpoint } from "./endpoints/url-records"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const environment = parseCmsEnvironment(process.env)

export default buildConfig({
  admin: {
    importMap: {
      baseDir: dirname,
      importMapFile: path.resolve(dirname, "app/(payload)/admin/importMap.ts"),
    },
    user: Users.slug,
    meta: {
      description: "Geo Foundry content operations workspace",
      icons: [{ rel: "icon", type: "image/svg+xml", url: "/favicon.svg" }],
      titleSuffix: " | Geo Foundry",
    },
    components: {
      beforeLogin: ["/components/branding/LoginIntro#LoginIntro"],
      graphics: {
        Icon: "/components/branding/GeoIcon#GeoIcon",
        Logo: "/components/branding/GeoLogo#GeoLogo",
      },
      header: ["/components/header/Header#Header"],
      Nav: "/components/nav/Nav#Nav",
      views: {
        dashboard: {
          Component: "/components/dashboard/OperationsDashboard#OperationsDashboard",
        },
      },
    },
    // 不依赖外部 Gravatar 服务（测试/生产网络不可达，导致管理端页面 console error 与请求超时）
    avatar: "default",
  },
  collections: [
    Tenants,
    Users,
    Sites,
    Domains,
    Contents,
    ContentEditions,
    Media,
    UrlRecords,
    QualityAssessments,
    Releases,
    RollbackIntents,
    OutboxEvents,
    Operations,
    IdempotencyRecords,
  ],
  i18n: {
    fallbackLanguage: "zh",
    translations: {
      en: {
        ...enTranslations,
        error: {
          ...enTranslations.error,
          notAllowedToAccessPage: "Your account does not have permission to access this page.",
          unauthorized: "You do not have permission to perform this action.",
        },
      },
      zh: {
        ...zhTranslations,
        error: {
          ...zhTranslations.error,
          notAllowedToAccessPage: "您的账号没有访问此页面的权限。",
          unauthorized: "您没有权限执行此操作。",
        },
      },
    },
  },
  endpoints: [
    createRollbackIntentEndpoint,
    createDraftFromPublishedEndpoint,
    submitPublishOperationEndpoint,
    transitionEditionEndpoint,
    renameUrlRecordEndpoint,
    ...allInternalEndpoints,
  ],
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
