import type { FieldHook } from "payload"

import { resolveTenantBinding } from "./tenant-binding"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const siblingRoleFrom = (siblingData: unknown): unknown =>
  isRecord(siblingData) ? siblingData["role"] : undefined

export const forceTenantFromSession: FieldHook = ({ value, req, siblingData }) =>
  resolveTenantBinding({
    value: typeof value === "string" || typeof value === "number" ? value : null,
    user: req.user,
    siblingRole: siblingRoleFrom(siblingData),
  })
