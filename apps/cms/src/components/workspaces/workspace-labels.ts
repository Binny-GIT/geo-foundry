import type { UiLang } from "../i18n/ui-lang"

const labelOf = (
  labels: Record<UiLang, Record<string, string>>,
  value: unknown,
  language: UiLang,
): string => (typeof value === "string" ? (labels[language][value] ?? value) : "—")

const ASSESSMENT = {
  en: { error: "Error", failed: "Failed", passed: "Passed", pending: "Pending" },
  zh: { error: "错误", failed: "失败", passed: "通过", pending: "待处理" },
} as const

const OPERATION_STATE = {
  en: {
    cancelled: "Cancelled",
    failed: "Failed",
    queued: "Queued",
    running: "Running",
    succeeded: "Succeeded",
  },
  zh: {
    cancelled: "已取消",
    failed: "失败",
    queued: "排队中",
    running: "运行中",
    succeeded: "成功",
  },
} as const

const OPERATION_TYPE = {
  en: { evaluate: "Evaluate", generate: "Generate", publish: "Publish", rollback: "Rollback" },
  zh: { evaluate: "质量评估", generate: "内容生成", publish: "发布", rollback: "回滚" },
} as const

const RELEASE_STATE = {
  en: {
    building: "Building",
    current: "Current",
    failed: "Failed",
    rolled_back: "Rolled back",
    superseded: "Superseded",
    uploaded: "Uploaded",
    validated: "Validated",
  },
  zh: {
    building: "构建中",
    current: "当前版本",
    failed: "失败",
    rolled_back: "已回滚",
    superseded: "已替代",
    uploaded: "已上传",
    validated: "已验证",
  },
} as const

const ROLE = {
  en: {
    "content-service": "Content service",
    editor: "Editor",
    publisher: "Publisher",
    reviewer: "Reviewer",
    "super-admin": "Super administrator",
    "tenant-admin": "Tenant administrator",
  },
  zh: {
    "content-service": "内容服务",
    editor: "编辑",
    publisher: "发布者",
    reviewer: "审核者",
    "super-admin": "超级管理员",
    "tenant-admin": "租户管理员",
  },
} as const

const SITE_STATUS = {
  en: { active: "Active", disabled: "Disabled" },
  zh: { active: "启用", disabled: "停用" },
} as const

export const assessmentStateLabel = (value: unknown, language: UiLang): string =>
  labelOf(ASSESSMENT, value, language)

export const operationStateLabel = (value: unknown, language: UiLang): string =>
  labelOf(OPERATION_STATE, value, language)

export const operationTypeLabel = (value: unknown, language: UiLang): string =>
  labelOf(OPERATION_TYPE, value, language)

export const releaseStateLabel = (value: unknown, language: UiLang): string =>
  labelOf(RELEASE_STATE, value, language)

export const roleLabel = (value: unknown, language: UiLang): string =>
  labelOf(ROLE, value, language)

export const siteStatusLabel = (value: unknown, language: UiLang): string =>
  labelOf(SITE_STATUS, value, language)
