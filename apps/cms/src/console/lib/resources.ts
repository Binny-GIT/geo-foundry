import {
  CheckCircleIcon,
  GlobeIcon,
  ImageIcon,
  LayersIcon,
  LayoutGridIcon,
  LinkIcon,
  PackageIcon,
  SearchIcon,
  SendIcon,
  UsersIcon,
  type IconProps,
} from "../../components/icons"
import { CMS_ACTION, CMS_RESOURCE, type CmsResource } from "../../access/policy"

export const VISIBLE_RESOURCE_SLUGS = [
  "users",
  "tenants",
  "sites",
  "domains",
  "contents",
  "content-editions",
  "media",
  "url-records",
  "quality-assessments",
  "releases",
  "rollback-intents",
  "publication-plans",
  "performance-snapshots",
  "operations",
] as const

export type ConsoleResourceSlug = (typeof VISIBLE_RESOURCE_SLUGS)[number]

/**
 * Page-level section for the Console eyebrow label. The sidebar itself only
 * renders CONSOLE_NAV; resources outside the nav keep their routes and show
 * their section on the page header.
 */
export type ConsoleSectionKey = "articles" | "sites" | "publishing" | "system"

export const CONSOLE_SECTION_LABELS: Readonly<
  Record<ConsoleSectionKey, { readonly en: string; readonly zh: string }>
> = {
  articles: { en: "Articles", zh: "文章" },
  sites: { en: "Sites", zh: "站点" },
  publishing: { en: "Publishing", zh: "发布" },
  system: { en: "System", zh: "系统" },
}

type ConsoleResource = {
  readonly apiSlug: ConsoleResourceSlug
  readonly defaultColumns: readonly string[]
  readonly section: ConsoleSectionKey
  readonly icon: (props: IconProps) => React.JSX.Element
  readonly label: { readonly en: string; readonly zh: string }
  readonly relationshipColumns?: readonly string[]
  readonly resource: CmsResource | null
  readonly searchField?: string
  readonly subtitle: { readonly en: string; readonly zh: string }
}

export const CONSOLE_RESOURCES: Readonly<Record<ConsoleResourceSlug, ConsoleResource>> = {
  users: {
    apiSlug: "users",
    defaultColumns: ["email", "role", "tenant", "updatedAt"],
    section: "system",
    icon: UsersIcon,
    label: { en: "System Users", zh: "系统用户管理" },
    relationshipColumns: ["tenant"],
    resource: CMS_RESOURCE.USERS,
    subtitle: { en: "Accounts, roles, and access boundaries", zh: "系统账号、角色与权限归属" },
  },
  tenants: {
    apiSlug: "tenants",
    defaultColumns: ["name", "updatedAt"],
    section: "system",
    icon: UsersIcon,
    label: { en: "Tenants", zh: "租户" },
    resource: CMS_RESOURCE.TENANTS,
    subtitle: { en: "Isolated data boundaries grouping sites and users", zh: "隔离的数据边界（站点与用户的分组）" },
  },
  sites: {
    apiSlug: "sites",
    defaultColumns: ["name", "status", "locale", "timezone", "updatedAt"],
    section: "sites",
    icon: GlobeIcon,
    label: { en: "Sites", zh: "站点列表" },
    relationshipColumns: ["tenant"],
    resource: CMS_RESOURCE.SITES,
    subtitle: { en: "Publishing targets that read articles from this system", zh: "读取文章的发布目标网站" },
  },
  domains: {
    apiSlug: "domains",
    defaultColumns: ["hostname", "site", "role", "status", "updatedAt"],
    section: "system",
    icon: LinkIcon,
    label: { en: "Domains", zh: "域名" },
    relationshipColumns: ["site"],
    resource: CMS_RESOURCE.DOMAINS,
    subtitle: { en: "Canonical hostnames and aliases", zh: "主域名与别名管理（站点详情内维护）" },
  },
  contents: {
    apiSlug: "contents",
    defaultColumns: ["topic", "intent", "createdBy", "updatedAt"],
    section: "system",
    icon: SearchIcon,
    label: { en: "Contents", zh: "内容条目" },
    resource: CMS_RESOURCE.CONTENTS,
    subtitle: { en: "Content briefs and production intent", zh: "内容简报与生产意图" },
  },
  "content-editions": {
    apiSlug: "content-editions",
    defaultColumns: ["title", "site", "workflowStatus", "updatedAt"],
    section: "articles",
    icon: SearchIcon,
    label: { en: "Articles", zh: "文章列表" },
    relationshipColumns: ["content", "site", "tenant"],
    resource: CMS_RESOURCE.EDITIONS,
    subtitle: { en: "Every article: filter, search, and lifecycle", zh: "全部文章的筛选、搜索与生命周期管理" },
  },
  media: {
    apiSlug: "media",
    defaultColumns: ["filename", "alt", "updatedAt"],
    section: "system",
    icon: ImageIcon,
    label: { en: "OSS Storage", zh: "OSS存储" },
    resource: CMS_RESOURCE.MEDIA,
    subtitle: { en: "Media files stored in object storage", zh: "对象存储中的媒体文件" },
  },
  "url-records": {
    apiSlug: "url-records",
    defaultColumns: ["pathname", "state", "site", "updatedAt"],
    section: "system",
    icon: LinkIcon,
    label: { en: "URL Records", zh: "URL 记录" },
    relationshipColumns: ["content", "site", "targetUrl"],
    resource: CMS_RESOURCE.URL_RECORDS,
    subtitle: { en: "Read-only URL registry and controlled renames", zh: "只读 URL 台账与受控重命名" },
  },
  "quality-assessments": {
    apiSlug: "quality-assessments",
    defaultColumns: ["edition", "state", "overall", "updatedAt"],
    section: "system",
    icon: CheckCircleIcon,
    label: { en: "Quality Assessments", zh: "质量评估" },
    relationshipColumns: ["edition", "site", "tenant"],
    resource: CMS_RESOURCE.ASSESSMENTS,
    subtitle: { en: "Immutable quality evidence", zh: "不可变质量证据" },
  },
  releases: {
    apiSlug: "releases",
    defaultColumns: ["releaseId", "site", "state", "updatedAt"],
    section: "system",
    icon: PackageIcon,
    label: { en: "Releases", zh: "发布版本" },
    relationshipColumns: ["site", "tenant"],
    resource: CMS_RESOURCE.RELEASES,
    subtitle: { en: "Immutable release registry", zh: "不可变发布版本台账" },
  },
  "performance-snapshots": {
    apiSlug: "performance-snapshots",
    defaultColumns: ["site", "edition", "source", "observedAt", "visits", "updatedAt"],
    section: "system",
    icon: LayersIcon,
    label: { en: "Traffic Statistics", zh: "流量统计" },
    relationshipColumns: ["edition", "site", "tenant"],
    resource: CMS_RESOURCE.PERFORMANCE_SNAPSHOTS,
    subtitle: { en: "Imported traffic observations for reading analytics", zh: "导入的流量统计数据（阅读分析的数据源）" },
  },
  "publication-plans": {
    apiSlug: "publication-plans",
    defaultColumns: ["edition", "site", "scheduledFor", "timezone", "status", "updatedAt"],
    section: "publishing",
    icon: SendIcon,
    label: { en: "Publication Plans", zh: "发布排期" },
    relationshipColumns: ["edition", "site", "tenant"],
    resource: CMS_RESOURCE.PUBLICATION_PLANS,
    subtitle: { en: "UTC schedules and publisher-authorized release execution", zh: "UTC 排期与发布者授权执行" },
  },
  "rollback-intents": {
    apiSlug: "rollback-intents",
    defaultColumns: ["intentId", "site", "consumedAt", "updatedAt"],
    section: "system",
    icon: SendIcon,
    label: { en: "Rollback Intents", zh: "回滚意图" },
    relationshipColumns: ["site", "tenant"],
    resource: CMS_RESOURCE.RELEASES,
    subtitle: { en: "Publisher-approved rollback commands", zh: "发布者批准的回滚命令" },
  },
  operations: {
    apiSlug: "operations",
    defaultColumns: ["operationId", "operationType", "state", "updatedAt"],
    section: "system",
    icon: SendIcon,
    label: { en: "Operation Log", zh: "操作日志" },
    resource: CMS_RESOURCE.OPERATIONS,
    subtitle: { en: "Auditable async operations and failure triage", zh: "可审计的异步操作与失败排查" },
  },
}

export const FIRST_WAVE_MUTABLE_RESOURCES = ["contents", "domains", "sites", "tenants"] as const

export const isFirstWaveMutableResource = (value: ConsoleResourceSlug): boolean =>
  (FIRST_WAVE_MUTABLE_RESOURCES as readonly string[]).includes(value)

export type ConsoleNavItem =
  | {
      readonly href: string
      readonly icon: (props: IconProps) => React.JSX.Element
      readonly kind: "static"
      readonly label: { readonly en: string; readonly zh: string }
    }
  | { readonly kind: "resource"; readonly slug: ConsoleResourceSlug }

/**
 * The sidebar is organized around the operator's pipeline (console → workbench
 * → articles → sites) instead of mirroring collection tables. Registry
 * resources are permission-filtered by the caller; static routes are available
 * to every human role.
 */
export const CONSOLE_NAV: Readonly<{
  readonly admin: readonly ConsoleNavItem[]
  readonly business: readonly ConsoleNavItem[]
}> = {
  business: [
    {
      href: "/admin",
      icon: LayoutGridIcon,
      kind: "static",
      label: { en: "Console", zh: "控制台" },
    },
    {
      href: "/admin/work",
      icon: LayersIcon,
      kind: "static",
      label: { en: "Workbench", zh: "工作台" },
    },
    { kind: "resource", slug: "content-editions" },
    { kind: "resource", slug: "sites" },
  ],
  admin: [
    { kind: "resource", slug: "users" },
    { kind: "resource", slug: "operations" },
    { kind: "resource", slug: "media" },
    {
      href: "/admin/integration-docs",
      icon: LinkIcon,
      kind: "static",
      label: { en: "Integration Docs", zh: "接入文档" },
    },
    {
      href: "/admin/api-stats",
      icon: PackageIcon,
      kind: "static",
      label: { en: "API Stats", zh: "接口统计" },
    },
  ],
}

export const isConsoleResourceSlug = (value: string): value is ConsoleResourceSlug =>
  (VISIBLE_RESOURCE_SLUGS as readonly string[]).includes(value)

export const consoleRoute = {
  account: "/admin/account",
  collection: (slug: ConsoleResourceSlug) => `/admin/collections/${slug}`,
  dashboard: "/admin",
  document: (slug: ConsoleResourceSlug, id: number | string) =>
    `/admin/collections/${slug}/${id}`,
  login: "/admin/login",
} as const

export const canCreateResource = (resource: ConsoleResource, can: (resource: CmsResource, action: typeof CMS_ACTION.CREATE) => boolean) =>
  resource.resource !== null && can(resource.resource, CMS_ACTION.CREATE)
