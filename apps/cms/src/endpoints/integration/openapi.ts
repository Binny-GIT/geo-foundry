/*
 * 投稿面 OpenAPI 文档：服务外部自动化工具（n8n / Dify / 自研脚本）。
 *
 * 与 endpoints/internal/openapi.ts 的分工：那边是 CMS↔Worker 的零信任
 * 面，读者是 content-client；这边是「采集投稿」面，读者是租户自己签发
 * 的 automation API-Key。文档追求 LLM 可直接生成可运行调用：认证头
 * 格式、通道语义、幂等规则、守卫限额全部写进 description。
 *
 * 字节稳定性：本文档经 stableStringify 落 fixture（apps/cms/contracts/
 * integration-openapi.json），字段顺序即字节顺序，改动需同步 fixture。
 */

export const INTEGRATION_API_VERSION = "1.0.0"

export type IntegrationOperationDescriptor = {
  readonly method: "get" | "post"
  readonly operationId: string
  readonly path: string
}

/** OpenAPI 风格路径（servers 基址 /api）；契约测试拿它对账真实路由识别函数。 */
export const INTEGRATION_OPERATIONS: readonly IntegrationOperationDescriptor[] = [
  { method: "post", operationId: "createIntakeItem", path: "/intake-operations" },
  { method: "get", operationId: "listSites", path: "/sites" },
  { method: "get", operationId: "listConnectors", path: "/connectors" },
  {
    method: "get",
    operationId: "listPublishedArticles",
    path: "/delivery/sites/{domain}/articles",
  },
  { method: "get", operationId: "getPublishedArticle", path: "/delivery/articles/{id}" },
]

const AUTH_DESCRIPTION =
  "Authorization: users API-Key gfa_xxx（租户管理员在 Console「集成密钥」页签发）。密钥只绑本租户；吊销或过期立即失效。"

const INTAKE_REQUEST_SCHEMA = {
  additionalProperties: false,
  description:
    "投稿入稿源箱。channel=webhook 直投正文：bodyMarkdown 与 suggestedSiteId 必填，校验通过直接 ready 等人工采纳；channel=url/rss 只投 URL：填 sourceUrl（rss 可带 connectorId），平台排队抓取。",
  properties: {
    bodyMarkdown: {
      description:
        "Markdown 正文，仅 webhook 通道；上限 200k 字符，块结构校验失败返回 400（错误码即校验规则名）。",
      maxLength: 200_000,
      type: "string",
    },
    channel: {
      description:
        "投稿通道：webhook=直投正文（推荐自动化工具）；url=投链接平台抓取；rss=配合 connectorId。",
      enum: ["manual", "url", "webhook", "rss"],
      type: "string",
    },
    connectorId: {
      description: "关联采集源 id（可选，一般由平台轮询使用，外部工具通常不填）。",
      type: "integer",
    },
    contentHash: {
      description:
        "调用方内容寻址哈希（可选）。提供后同哈希重投走幂等快速路径，优先级高于正文/幂等键派生。",
      maxLength: 512,
      type: "string",
    },
    sourceUrl: {
      description: "来源 URL（url/rss 通道填；webhook 直投可留作溯源）。",
      maxLength: 4_000,
      type: "string",
    },
    suggestedSiteId: {
      description: "建议采纳站点 id（webhook 通道必填；GET /sites 可查本租户可选值）。",
      type: "integer",
    },
    summary: { description: "摘要（可选）。", maxLength: 20_000, type: "string" },
    title: { description: "标题（必填，去重键之一）。", maxLength: 1_000, type: "string" },
  },
  required: ["channel", "title"],
  type: "object",
}

const INTAKE_ITEM_SCHEMA = {
  description: "稿源条目快照。",
  properties: {
    channel: { type: "string" },
    contentHash: { type: "string" },
    duplicateOf: { description: "重复判定命中的既有条目 id。", type: "integer" },
    duplicateStatus: { enum: ["unique", "duplicate"], type: "string" },
    failureCode: { type: "string" },
    failureReason: { type: "string" },
    id: { type: "integer" },
    mergedInto: { type: "integer" },
    sourceUrl: { type: "string" },
    status: {
      description:
        "new=待处理；fetching=抓取中；ready=内容就绪等人工采纳；failed=抓取失败；duplicate/ignored/merged/adopted=终态。",
      type: "string",
    },
    suggestedSite: { type: "integer" },
    summary: { type: "string" },
    tenant: { type: "integer" },
    title: { type: "string" },
  },
  type: "object",
}

const PAGE_QUERY_PARAMETERS = [
  {
    description: "每页条数（1-100，默认 10）。",
    in: "query",
    name: "limit",
    required: false,
    schema: { maximum: 100, minimum: 1, type: "integer" },
  },
  {
    description: "页码（默认 1）。",
    in: "query",
    name: "page",
    required: false,
    schema: { minimum: 1, type: "integer" },
  },
  {
    description:
      "排序：createdAt / -createdAt / name / -name / updatedAt / -updatedAt（默认 -createdAt）。",
    in: "query",
    name: "sort",
    required: false,
    schema: { type: "string" },
  },
]

const ERROR_SCHEMA_REF = {
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
}

const jsonBody = (schema: unknown) => ({
  content: { "application/json": { schema } },
})

const ofRef = (name: string) => ({ $ref: `#/components/schemas/${name}` })

/*
 * 手写富 schema 的 paths（键按字母序，字节稳定性由此保证）；与
 * INTEGRATION_OPERATIONS 的同步由 integration-contracts.test.ts 守卫。
 */
const documentPaths = (): Record<string, Record<string, Record<string, unknown>>> => {
  const paths: Record<string, Record<string, Record<string, unknown>>> = {
    "/connectors": {
      get: {
        description:
          "本租户采集源列表（只读）。外部工具一般只读不写；采集源的增删改在 Console「采集源」页人工操作。",
        operationId: "listConnectors",
        parameters: PAGE_QUERY_PARAMETERS,
        responses: {
          "200": {
            description:
              "分页采集源（docs[].id/name/type/sourceEndpoint/status/pollIntervalMinutes/lastPolledAt）。",
            ...jsonBody(ofRef("PaginatedList")),
          },
          "401": { description: "缺少或无效的 API-Key。" },
          "403": { description: "身份无 sites/connectors 读权限。" },
        },
        security: [{ usersApiKey: [] }],
        tags: ["reference"],
      },
    },
    "/delivery/articles/{id}": {
      get: {
        description: "公开只读：单篇已发布文章的完整正文块与 URL。未发布或站点未启用一律 404。",
        operationId: "getPublishedArticle",
        parameters: [{ $ref: "#/components/parameters/ArticleId" }],
        responses: {
          "200": {
            description: "文章详情（含 body 块数组与 locale）。",
            ...jsonBody(ofRef("PublishedArticle")),
          },
          "400": { description: "id 非正整数。" },
          "404": { description: "文章不存在或未发布。" },
          "429": { description: "限流（每 IP 每分钟 60 次）。" },
        },
        tags: ["delivery"],
      },
    },
    "/delivery/sites/{domain}/articles": {
      get: {
        description:
          "公开只读：按「启用站点的规范域名」拉取已发布文章列表。带 60 秒 HTTP 缓存头，建议客户端再缓存 5-15 分钟。",
        operationId: "listPublishedArticles",
        parameters: [
          { $ref: "#/components/parameters/CanonicalDomain" },
          {
            description: "标题关键词（可选）。",
            in: "query",
            name: "q",
            required: false,
            schema: { maxLength: 100, type: "string" },
          },
          {
            description: "每页条数（1-50，默认 20）。",
            in: "query",
            name: "limit",
            required: false,
            schema: { maximum: 50, minimum: 1, type: "integer" },
          },
          {
            description: "页码（默认 1）。",
            in: "query",
            name: "page",
            required: false,
            schema: { minimum: 1, type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "分页文章（docs[].id/title/summary/pathname/publishedAt）。",
            ...jsonBody(ofRef("PaginatedList")),
          },
          "404": { description: "域名不是任何启用站点的规范域名。" },
          "429": { description: "限流（每 IP 每分钟 60 次）。" },
        },
        tags: ["delivery"],
      },
    },
    "/intake-operations": {
      post: {
        description:
          "向稿源箱投稿。守卫：API-Key 请求限 120 次/分钟/身份、请求体上限 1MiB。幂等：优先 contentHash，其次 webhook 正文哈希，再次 Idempotency-Key；重试返回首次结果（idempotentReplay=true 或 duplicateIds 指向既有行），不新增稿源。投稿只进稿源箱——采纳成草稿、编辑、发布始终由人在 Console 完成，API 身份无这些权限。",
        operationId: "createIntakeItem",
        parameters: [
          {
            description: "显式幂等键（可选，[A-Za-z0-9._-]{8,128}）。未提供时按正文派生哈希幂等。",
            in: "header",
            name: "Idempotency-Key",
            required: false,
            schema: { type: "string" },
          },
          {
            description: "调用方请求 id（可选）。提供时原样回显在响应头，便于对账。",
            in: "header",
            name: "X-Request-Id",
            required: false,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          content: { "application/json": { schema: INTAKE_REQUEST_SCHEMA } },
          required: true,
        },
        responses: {
          "200": {
            description: "命中重复或幂等重放：duplicateIds 指向既有条目，未新增稿源。",
            ...jsonBody(ofRef("IntakeCreateResponse")),
          },
          "201": {
            description:
              "新建成功：webhook 直投 status=ready；url/rss 已入抓取队列 fetchQueued=true。",
            ...jsonBody(ofRef("IntakeCreateResponse")),
          },
          "202": {
            description: "已建档但抓取队列暂不可用（status=new，可稍后 retry）。",
            ...jsonBody(ofRef("IntakeCreateResponse")),
          },
          "400": {
            description:
              "结构校验失败：INTAKE_CREATE_BODY_INVALID / INTAKE_SUGGESTED_SITE_REQUIRED / INTAKE_BODY_MARKDOWN_EMPTY / INTAKE_BODY_MARKDOWN_CHANNEL_INVALID / INTEGRATION_IDEMPOTENCY_KEY_INVALID，或正文块校验错误码。",
            ...ERROR_SCHEMA_REF,
          },
          "401": {
            description: "缺少或无效的 API-Key（INTAKE_UNAUTHENTICATED）。",
            ...ERROR_SCHEMA_REF,
          },
          "403": {
            description: "身份不是编辑/automation 投稿身份（INTAKE_EDITOR_REQUIRED）。",
            ...ERROR_SCHEMA_REF,
          },
          "413": {
            description: "请求体超过 1MiB（INTEGRATION_BODY_TOO_LARGE）。",
            ...ERROR_SCHEMA_REF,
          },
          "429": {
            description: "超过每身份限流（INTEGRATION_RATE_LIMITED）。",
            ...ERROR_SCHEMA_REF,
          },
        },
        security: [{ usersApiKey: [] }],
        tags: ["intake"],
      },
    },
    "/sites": {
      get: {
        description:
          "本租户站点列表（只读）。用于投稿前查 suggestedSiteId 可选值（docs[].id 即站点 id，status=active 才可被建议）。",
        operationId: "listSites",
        parameters: PAGE_QUERY_PARAMETERS,
        responses: {
          "200": {
            description: "分页站点（docs[].id/name/locale/status/tenant，含内容策略）。",
            ...jsonBody(ofRef("PaginatedList")),
          },
          "401": { description: "缺少或无效的 API-Key。" },
          "403": { description: "身份无 sites 读权限。" },
        },
        security: [{ usersApiKey: [] }],
        tags: ["reference"],
      },
    },
  }
  return paths
}

export const integrationOpenApiDocument = {
  components: {
    parameters: {
      ArticleId: {
        description: "文章（edition）id。",
        in: "path",
        name: "id",
        required: true,
        schema: { minimum: 1, type: "integer" },
      },
      CanonicalDomain: {
        description: "站点启用状态的规范域名，例如 www.example.com。",
        in: "path",
        name: "domain",
        required: true,
        schema: { type: "string" },
      },
    },
    schemas: {
      Error: {
        description: "统一错误体：code 是稳定错误码，可直接用于分支处理。",
        properties: { error: { properties: { code: { type: "string" } }, type: "object" } },
        type: "object",
      },
      IntakeCreateResponse: {
        properties: {
          duplicateIds: {
            description: "重复判定命中的既有条目 id。",
            items: { type: "integer" },
            type: "array",
          },
          fetchQueued: { description: "是否已入抓取队列（url/rss 通道）。", type: "boolean" },
          idempotentReplay: {
            description: "true 表示本次是幂等重放，未新增稿源。",
            type: "boolean",
          },
          intakeItem: INTAKE_ITEM_SCHEMA,
        },
        type: "object",
      },
      PaginatedList: {
        description: "统一分页信封：docs + page/limit/totalDocs/totalPages/hasNextPage 等。",
        properties: {
          docs: { items: { type: "object" }, type: "array" },
          hasNextPage: { type: "boolean" },
          limit: { type: "integer" },
          page: { type: "integer" },
          totalDocs: { type: "integer" },
          totalPages: { type: "integer" },
        },
        type: "object",
      },
      PublishedArticle: {
        properties: {
          body: {
            description: "正文块数组（结构化 markdown 块）。",
            items: { type: "object" },
            type: "array",
          },
          id: { type: "integer" },
          locale: { type: "string" },
          pathname: { type: "string" },
          publishedAt: { type: "string" },
          summary: { type: "string" },
          title: { type: "string" },
        },
        type: "object",
      },
    },
    securitySchemes: {
      usersApiKey: {
        description: AUTH_DESCRIPTION,
        in: "header",
        name: "Authorization",
        type: "apiKey",
      },
    },
  },
  info: {
    description:
      "Geo Foundry 采集投稿面：外部自动化工具（n8n / Dify / 脚本 / AI agent）向租户稿源箱投稿。能力边界：automation API-Key 只能投稿、读稿源箱引用数据（sites/connectors）与公开 delivery 只读接口；不能采纳成草稿、不能创建或编辑文章、不能发布、不能访问任何 internal 端点。投稿产出一律进入稿源箱等待人工处理。",
    title: "Geo Foundry Integration API",
    version: INTEGRATION_API_VERSION,
  },
  openapi: "3.1.0",
  paths: documentPaths(),
  servers: [{ url: "/api" }],
  tags: [
    { description: "投稿进稿源箱（automation 身份）", name: "intake" },
    { description: "投稿引用数据：站点与采集源（automation 身份，只读）", name: "reference" },
    { description: "公开只读已发布内容（无需认证）", name: "delivery" },
  ],
}
