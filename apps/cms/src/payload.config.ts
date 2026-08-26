import path from "node:path"
import { fileURLToPath } from "node:url"
import { postgresAdapter } from "@payloadcms/db-postgres"
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant"
import { BlocksFeature, lexicalEditor } from "@payloadcms/richtext-lexical"
import { s3Storage } from "@payloadcms/storage-s3"
import { en as enLanguage, enTranslations } from "@payloadcms/translations/languages/en"
import { zh as zhLanguage, zhTranslations } from "@payloadcms/translations/languages/zh"
import { buildConfig } from "payload"

import { ContentEditions } from "./collections/ContentEditions"
import { EditionDraftRestoreIdempotency } from "./collections/EditionDraftRestoreIdempotency"
import { Contents } from "./collections/Contents"
import { Domains } from "./collections/Domains"
import { IdempotencyRecords } from "./collections/IdempotencyRecords"
import { ReviewerEditionDecisionIdempotency } from "./collections/ReviewerEditionDecisionIdempotency"
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
import {
  reviewerApproveEditionEndpoint,
  reviewerRequestChangesEditionEndpoint,
} from "./endpoints/reviewer-edition-decisions"
import {
  editionVersionHistoryEndpoint,
  restoreEditionDraftEndpoint,
} from "./endpoints/edition-version-history"
import { allInternalEndpoints } from "./endpoints/internal/index"
import { createRollbackIntentEndpoint } from "./endpoints/rollback-intents"
import { renameUrlRecordEndpoint } from "./endpoints/url-records"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const environment = parseCmsEnvironment(process.env)

export default buildConfig({
  // Payload remains the backend/auth/RBAC engine. Its generated admin is a
  // super-admin-only emergency fallback; the product Console owns /admin.
  routes: {
    admin: "/admin/_emergency",
  },
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
      Nav: "/components/nav/Nav#Nav",
      views: {
        dashboard: {
          Component: "/components/dashboard/OperationsDashboard#OperationsDashboard",
        },
        workQueue: {
          Component: "/components/views/WorkQueue#WorkQueue",
          exact: true,
          path: "/work",
        },
        editionWorkspace: {
          Component: "/components/views/EditionWorkspace#EditionWorkspace",
          exact: true,
          path: "/work/editions/:id",
        },
        operationDetail: {
          Component: "/components/views/OperationDetail#OperationDetail",
          exact: true,
          path: "/work/operations/:id",
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
    EditionDraftRestoreIdempotency,
    Media,
    UrlRecords,
    QualityAssessments,
    Releases,
    RollbackIntents,
    OutboxEvents,
    Operations,
    IdempotencyRecords,
    ReviewerEditionDecisionIdempotency,
  ],
  i18n: {
    // Without `supportedLanguages`, Payload's sanitizer keeps only its
    // default `{ en }` and silently discards the `zh` fallback (verified in
    // dist/config/sanitize.js: a fallback outside the supported keys falls
    // back to the first supported key). The result was an admin UI locked
    // to English — the payload-lng cookie and Accept-Language could never
    // select zh because initI18n throws on unsupported languages. The
    // language packs (with dateFNSKey + context-tagged translations) are
    // what supportedLanguages wants; `translations` below stays as the
    // override layer merged on top per language.
    fallbackLanguage: "zh",
    supportedLanguages: {
      en: enLanguage,
      zh: zhLanguage,
    },
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
    reviewerApproveEditionEndpoint,
    reviewerRequestChangesEditionEndpoint,
    editionVersionHistoryEndpoint,
    restoreEditionDraftEndpoint,
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
