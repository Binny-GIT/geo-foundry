export const CMS_ROLE = {
  CONTENT_SERVICE: "content-service",
  EDITOR: "editor",
  PUBLISHER: "publisher",
  REVIEWER: "reviewer",
  SUPER_ADMIN: "super-admin",
  TENANT_ADMIN: "tenant-admin",
} as const

export type CmsRole = (typeof CMS_ROLE)[keyof typeof CMS_ROLE]

export const CMS_ROLES: readonly CmsRole[] = [
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
