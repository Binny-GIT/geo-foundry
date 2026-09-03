"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { CheckCircleIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import DeferredText from "@/console/components/DeferredText"

type Option = {
  readonly id: number
  readonly label: string
}

const ASSIGNMENT_ERRORS: Readonly<Record<string, string>> = {
  EDITION_ASSIGNMENT_FORBIDDEN: "只有编辑、租户管理员或超级管理员可以修改分配。",
  EDITION_ASSIGNMENT_TENANT_MISMATCH: "无权修改其他租户的文章。",
  EDITION_ASSIGNMENT_OWNER_NOT_FOUND: "所选用户不存在。",
  EDITION_ASSIGNMENT_OWNER_INVALID: "服务身份不能作为负责人。",
  EDITION_ASSIGNMENT_OWNER_TENANT_MISMATCH: "负责人必须属于文章所在租户。",
  EDITION_ASSIGNMENT_SITE_NOT_FOUND: "所选站点不存在。",
  EDITION_ASSIGNMENT_SITE_TENANT_MISMATCH: "站点必须属于文章所在租户。",
}

const errorTextOf = (code: unknown): string =>
  (typeof code === "string" ? ASSIGNMENT_ERRORS[code] : undefined) ??
  (typeof code === "string" && code.length > 0
    ? `操作未能完成（${code}），请刷新后重试。`
    : "操作未能完成，请刷新后重试。")

const selectClass =
  "gf-console-focus h-10 w-full rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none disabled:cursor-not-allowed disabled:opacity-60"

/*
 * Article detail assignment panel (free multi-site model): reassign the
 * owning editor and the article's site set — one article can live on many
 * sites; readers on each site only see what is assigned to it. The legacy
 * per-site variant fan-out is gone.
 */
const ArticleAssignmentPanel = ({
  canAssign,
  editionId,
  owner,
  siteIds,
  sites,
  users,
}: {
  readonly canAssign: boolean
  readonly editionId: number
  readonly owner: string
  readonly siteIds: readonly number[]
  readonly sites: readonly Option[]
  readonly users: readonly Option[]
}) => {
  const router = useRouter()
  const [ownerValue, setOwnerValue] = useState(owner)
  const [pickedSites, setPickedSites] = useState<readonly number[]>(siteIds)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)

  const ownerChanged = ownerValue !== owner
  const sitesChanged =
    pickedSites.length !== siteIds.length || pickedSites.some((id) => !siteIds.includes(id))

  const saveAssignment = async () => {
    if (!ownerChanged && !sitesChanged) return
    setPending(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/editions/${editionId}/assignment`, {
        body: JSON.stringify({
          ...(ownerChanged ? { owner: ownerValue === "" ? null : Number(ownerValue) } : {}),
          ...(sitesChanged ? { sites: [...pickedSites] } : {}),
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const result = (await response.json().catch(() => ({}))) as { error?: { code?: unknown } }
      if (!response.ok) throw new Error(errorTextOf(result.error?.code))
      setNotice({ ok: true, text: "分配已更新" })
      router.refresh()
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : errorTextOf(undefined),
      })
    } finally {
      setPending(false)
    }
  }

  const toggleSite = (id: number) => {
    setPickedSites((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  return (
    <section className="gf-console-card grid gap-4 p-5">
      <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
        分配
      </h2>

      {notice !== null && (
        <p
          className={`m-0 rounded-md border px-3.5 py-2.5 text-sm ${
            notice.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {canAssign ? (
        <div className="grid gap-3 border-t border-[var(--console-border)] pt-4">
          <label className="grid gap-1.5 text-sm font-medium text-[var(--console-ink)]">
            负责人
            <select
              className={selectClass}
              disabled={pending}
              onChange={(event) => setOwnerValue(event.target.value)}
              value={ownerValue}
            >
              <option value="">未分配</option>
              {users.map((user) => (
                <option key={user.id} value={String(user.id)}>
                  {/* 邮箱文本不能进 SSR HTML：Cloudflare 邮箱混淆会改写文本导致水合失败 */}
                  <DeferredText>{user.label}</DeferredText>
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-[var(--console-ink)]">所属站点（可多选）</span>
            <p className="m-0 text-xs leading-5 text-[var(--console-ink-muted)]">
              一篇文章可同时分配多个站点；各站点只呈现分配给自己的文章。
            </p>
            <div className="grid gap-2">
              {sites.map((site) => (
                <label
                  className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--console-ink)]"
                  key={site.id}
                >
                  <input
                    checked={pickedSites.includes(site.id)}
                    className="gf-console-focus h-4 w-4 accent-indigo-600"
                    disabled={pending}
                    onChange={() => toggleSite(site.id)}
                    type="checkbox"
                  />
                  {site.label}
                </label>
              ))}
            </div>
          </div>
          <Button
            className="gf-console-focus disabled:cursor-wait"
            disabled={pending || (!ownerChanged && !sitesChanged)}
            onClick={() => void saveAssignment()}
            size="md"
            type="button"
          >
            <CheckCircleIcon size={15} />
            {pending ? "保存中…" : "保存分配"}
          </Button>
        </div>
      ) : (
        <p className="m-0 border-t border-[var(--console-border)] pt-4 text-sm leading-6 text-[var(--console-ink-muted)]">
          当前角色只能查看分配；如需改派负责人或站点，请联络编辑或租户管理员。
        </p>
      )}
    </section>
  )
}

export default ArticleAssignmentPanel
