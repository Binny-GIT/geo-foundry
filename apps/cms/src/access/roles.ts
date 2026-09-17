export const CMS_ROLE = {
  /** 外部 AI/自动化工具的投稿身份：只能把素材送进稿源箱，不能成稿、不能发布。 */
  AUTOMATION: "automation",
  CONTENT_SERVICE: "content-service",
  EDITOR: "editor",
  PUBLISHER: "publisher",
  REVIEWER: "reviewer",
  SUPER_ADMIN: "super-admin",
  TENANT_ADMIN: "tenant-admin",
} as const

export type CmsRole = (typeof CMS_ROLE)[keyof typeof CMS_ROLE]

export const CMS_ROLES: readonly CmsRole[] = [
  CMS_ROLE.AUTOMATION,
  CMS_ROLE.CONTENT_SERVICE,
  CMS_ROLE.EDITOR,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.REVIEWER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
]

export function isCmsRole(value: unknown): value is CmsRole {
  return typeof value === "string" && (CMS_ROLES as readonly string[]).includes(value)
}
