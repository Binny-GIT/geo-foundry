import type { FieldHook } from "payload"

import { resolveRoleAssignment } from "./role-assignment"
import { resolveSessionClaims } from "./session"

export const forceRoleFromSession: FieldHook = async ({ value, req }) => {
  const claims = resolveSessionClaims(req.user)
  const usersEmpty =
    req.payload === undefined
      ? false
      : (await req.payload.count({ collection: "users" })).totalDocs === 0
  return resolveRoleAssignment({ incoming: value, claims, usersEmpty })
}
