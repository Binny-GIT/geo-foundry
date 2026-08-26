export type WorkspaceUser = {
  readonly role?: unknown
}

export type WorkspaceServerContext = {
  readonly initPageResult?:
    | {
        readonly req?: {
          readonly user?: WorkspaceUser | null | undefined
        }
      }
    | undefined
  readonly user?: WorkspaceUser | null | undefined
}

/**
 * Built-in dashboard views receive `user` at the top level, while arbitrary
 * admin path views receive it under `initPageResult.req`. Normalize both
 * Payload server-prop shapes before any role check or access-scoped query.
 */
export const workspaceUserOf = ({ initPageResult, user }: WorkspaceServerContext): WorkspaceUser | undefined =>
  user ?? initPageResult?.req?.user ?? undefined
