import {
  CheckCircleIcon,
  GlobeIcon,
  ImageIcon,
  LayersIcon,
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

type ConsoleResource = {
  readonly apiSlug: ConsoleResourceSlug
  readonly defaultColumns: readonly string[]
  readonly group: "access" | "sites" | "content" | "release"
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
    group: "access",
    icon: UsersIcon,
    label: { en: "Users", zh: "用户" },
    relationshipColumns: ["tenant"],
    resource: CMS_RESOURCE.USERS,
    subtitle: { en: "Access, roles, and tenant membership", zh: "访问权限、角色与租户归属" },
  },
  tenants: {
    apiSlug: "tenants",
    defaultColumns: ["name", "updatedAt"],
    group: "access",
    icon: UsersIcon,
    label: { en: "Tenants", zh: "租户" },
    resource: CMS_RESOURCE.TENANTS,
    subtitle: { en: "Tenant workspaces and access boundaries", zh: "租户工作区与访问边界" },
  },
  sites: {
    apiSlug: "sites",
    defaultColumns: ["name", "status", "locale", "timezone", "updatedAt"],
    group: "sites",
    icon: GlobeIcon,
    label: { en: "Sites", zh: "站点" },
    resource: CMS_RESOURCE.SITES,
    subtitle: { en: "Site configuration and operating readiness", zh: "站点配置与运营就绪度" },
  },
  domains: {
    apiSlug: "domains",
    defaultColumns: ["hostname", "site", "role", "status", "updatedAt"],
    group: "sites",
    icon: LinkIcon,
    label: { en: "Domains", zh: "域名" },
    relationshipColumns: ["site"],
    resource: CMS_RESOURCE.DOMAINS,
    subtitle: { en: "Canonical hostnames and aliases", zh: "主域名与别名管理" },
  },
  contents: {
    apiSlug: "contents",
    defaultColumns: ["topic", "intent", "createdBy", "updatedAt"],
    group: "content",
    icon: LayersIcon,
    label: { en: "Contents", zh: "内容条目" },
    resource: CMS_RESOURCE.CONTENTS,
    subtitle: { en: "Content briefs and production intent", zh: "内容简报与生产意图" },
  },
  "content-editions": {
    apiSlug: "content-editions",
    defaultColumns: ["title", "site", "workflowStatus", "updatedAt"],
    group: "content",
    icon: SearchIcon,
    label: { en: "Content Editions", zh: "内容版本" },
    relationshipColumns: ["content", "site", "tenant"],
    resource: CMS_RESOURCE.EDITIONS,
    subtitle: { en: "Drafts, review, evidence, and publication", zh: "草稿、审核、证据与发布" },
  },
  media: {
    apiSlug: "media",
    defaultColumns: ["filename", "alt", "updatedAt"],
    group: "content",
    icon: ImageIcon,
    label: { en: "Media", zh: "媒体库" },
    resource: CMS_RESOURCE.MEDIA,
    subtitle: { en: "Tenant-scoped files and accessibility metadata", zh: "租户隔离文件与无障碍元数据" },
  },
  "url-records": {
    apiSlug: "url-records",
    defaultColumns: ["pathname", "state", "site", "updatedAt"],
    group: "content",
    icon: LinkIcon,
    label: { en: "URL Records", zh: "URL 记录" },
    relationshipColumns: ["content", "site", "targetUrl"],
    resource: CMS_RESOURCE.URL_RECORDS,
    subtitle: { en: "Read-only URL registry and controlled renames", zh: "只读 URL 台账与受控重命名" },
  },
  "quality-assessments": {
    apiSlug: "quality-assessments",
    defaultColumns: ["edition", "state", "overall", "updatedAt"],
    group: "release",
    icon: CheckCircleIcon,
    label: { en: "Quality Assessments", zh: "质量评估" },
    relationshipColumns: ["edition", "site", "tenant"],
    resource: CMS_RESOURCE.ASSESSMENTS,
    subtitle: { en: "Immutable quality evidence", zh: "不可变质量证据" },
  },
  releases: {
    apiSlug: "releases",
    defaultColumns: ["releaseId", "site", "state", "updatedAt"],
    group: "release",
    icon: PackageIcon,
    label: { en: "Releases", zh: "发布版本" },
    relationshipColumns: ["site", "tenant"],
    resource: CMS_RESOURCE.RELEASES,
    subtitle: { en: "Immutable release registry", zh: "不可变发布版本台账" },
  },
  "performance-snapshots": {
    apiSlug: "performance-snapshots",
    defaultColumns: ["site", "edition", "source", "observedAt", "visits", "updatedAt"],
    group: "release",
    icon: LayersIcon,
    label: { en: "Performance Snapshots", zh: "表现快照" },
    relationshipColumns: ["edition", "site", "tenant"],
    resource: CMS_RESOURCE.PERFORMANCE_SNAPSHOTS,
    subtitle: { en: "Imported observations and deterministic refresh signals", zh: "导入观测与确定性更新信号" },
  },
  "publication-plans": {
    apiSlug: "publication-plans",
    defaultColumns: ["edition", "site", "scheduledFor", "timezone", "status", "updatedAt"],
    group: "release",
    icon: SendIcon,
    label: { en: "Publication Plans", zh: "发布计划" },
    relationshipColumns: ["edition", "site", "tenant"],
    resource: CMS_RESOURCE.PUBLICATION_PLANS,
    subtitle: { en: "UTC schedules and publisher-authorized release execution", zh: "UTC 排期与发布者授权执行" },
  },
  "rollback-intents": {
    apiSlug: "rollback-intents",
    defaultColumns: ["intentId", "site", "consumedAt", "updatedAt"],
    group: "release",
    icon: SendIcon,
    label: { en: "Rollback Intents", zh: "回滚意图" },
    relationshipColumns: ["site", "tenant"],
    resource: CMS_RESOURCE.RELEASES,
    subtitle: { en: "Publisher-approved rollback commands", zh: "发布者批准的回滚命令" },
  },
  operations: {
    apiSlug: "operations",
    defaultColumns: ["operationId", "operationType", "state", "updatedAt"],
    group: "release",
    icon: SendIcon,
    label: { en: "Operations", zh: "操作记录" },
    resource: CMS_RESOURCE.OPERATIONS,
    subtitle: { en: "Read-only asynchronous operation ledger", zh: "只读异步操作台账" },
  },
}

export const FIRST_WAVE_MUTABLE_RESOURCES = ["contents", "domains", "sites", "tenants"] as const

export const isFirstWaveMutableResource = (value: ConsoleResourceSlug): boolean =>
  (FIRST_WAVE_MUTABLE_RESOURCES as readonly string[]).includes(value)

export const CONSOLE_GROUPS = [
  { key: "access", label: { en: "Access", zh: "访问控制" } },
  { key: "sites", label: { en: "Sites & Domains", zh: "站点与域名" } },
  { key: "content", label: { en: "Content", zh: "内容" } },
  { key: "release", label: { en: "Quality & Release", zh: "质量与发布" } },
] as const

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
