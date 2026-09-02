"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { CheckCircleIcon, PlusIcon } from "@/components/icons"
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
  EDITION_ASSIGNMENT_SITE_LOCKED: "已编译、已发布或已归档的文章不能改派站点。",
}

const VARIANT_ERRORS: Readonly<Record<string, string>> = {
  SITE_VARIANT_ALREADY_EXISTS: "该站点已有对应版本，已跳过。",
  SITE_VARIANT_TARGET_SAME_SITE: "不能选择当前所属站点。",
  SITE_VARIANT_TENANT_MISMATCH: "无权分发到其他租户的站点。",
  SITE_VARIANT_EDITOR_REQUIRED: "只有编辑、租户管理员或超级管理员可以创建分发版本。",
}

const errorTextOf = (map: Readonly<Record<string, string>>, code: unknown): string =>
  (typeof code === "string" ? map[code] : undefined) ?? "操作未能完成，请刷新后重试。"

const selectClass =
  "gf-console-focus h-10 w-full rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none disabled:cursor-not-allowed disabled:opacity-60"

/**
 * Article detail assignment panel: reassign the owning editor and site through
 * the protected /editions/:id/assignment endpoint, and fan the content out to
 * more sites as independent variant drafts via the existing site-variant
 * endpoint (one edition per site keeps publishing URLs per-site).
 */
const ArticleAssignmentPanel = ({
  canAssign,
  coveredSiteIds,
  editionId,
  owner,
  site,
  siteLocked,
  sites,
  users,
}: {
  readonly canAssign: boolean
  readonly coveredSiteIds: readonly number[]
  readonly editionId: number
  readonly owner: string
  readonly site: string
  readonly siteLocked: boolean
  readonly sites: readonly Option[]
  readonly users: readonly Option[]
}) => {
  const router = useRouter()
  const [ownerValue, setOwnerValue] = useState(owner)
  const [siteValue, setSiteValue] = useState(site)
  const [variantPicks, setVariantPicks] = useState<readonly number[]>([])
  const [pending, setPending] = useState<"save" | "variant" | null>(null)
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)

  const ownerChanged = ownerValue !== owner
  const siteChanged = siteValue !== site
  const variantSites = sites.filter(
    (option) => !coveredSiteIds.includes(option.id) && String(option.id) !== site,
  )

  const saveAssignment = async () => {
    if (!ownerChanged && !siteChanged) return
    setPending("save")
    setNotice(null)
    try {
      const response = await fetch(`/api/editions/${editionId}/assignment`, {
        body: JSON.stringify({
          ...(ownerChanged ? { owner: ownerValue === "" ? null : Number(ownerValue) } : {}),
          ...(siteChanged ? { site: Number(siteValue) } : {}),
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const result = (await response.json().catch(() => ({}))) as { error?: { code?: unknown } }
      if (!response.ok) {
        throw new Error(errorTextOf(ASSIGNMENT_ERRORS, result.error?.code))
      }
      setNotice({ ok: true, text: "分配已更新" })
      router.refresh()
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : errorTextOf(ASSIGNMENT_ERRORS, undefined),
      })
    } finally {
      setPending(null)
    }
  }

  const createVariants = async () => {
    if (variantPicks.length === 0) return
    setPending("variant")
    setNotice(null)
    let created = 0
    const problems: string[] = []
    for (const siteId of variantPicks) {
      try {
        const response = await fetch(`/api/editions/${editionId}/site-variants`, {
          body: JSON.stringify({ siteId }),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "POST",
        })
        if (response.ok) {
          created += 1
          continue
        }
        const result = (await response.json().catch(() => ({}))) as { error?: { code?: unknown } }
        problems.push(errorTextOf(VARIANT_ERRORS, result.error?.code))
      } catch {
        problems.push("网络异常，该站点未能创建。")
      }
    }
    setVariantPicks([])
    setPending(null)
    if (created > 0) {
      setNotice({
        ok: problems.length === 0,
        text: `已为 ${created} 个站点创建分发草稿。${problems.length > 0 ? ` ${problems.join(" ")}` : ""}`.trim(),
      })
      router.refresh()
    } else {
      setNotice({ ok: false, text: problems.join(" ") || "未能创建分发草稿。" })
    }
  }

  return (
    <section className="gf-console-card grid gap-4 p-5">
      <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">分配</h2>

      {notice !== null && (
        <p
          className={`m-0 rounded-xl border px-3.5 py-2.5 text-sm ${
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
        <>
          <div className="grid gap-3 border-t border-[var(--console-border)] pt-4">
            <label className="grid gap-1.5 text-sm font-medium text-[var(--console-ink)]">
              负责人
              <select
                className={selectClass}
                disabled={pending !== null}
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
            <label className="grid gap-1.5 text-sm font-medium text-[var(--console-ink)]">
              所属站点
              <select
                className={selectClass}
                disabled={pending !== null || siteLocked}
                onChange={(event) => setSiteValue(event.target.value)}
                value={siteValue}
              >
                {sites.map((option) => (
                  <option key={option.id} value={String(option.id)}>
                    {option.label}
                  </option>
                ))}
              </select>
              {siteLocked && (
                <span className="text-xs leading-5 text-[var(--console-ink-muted)]">
                  已进入编译或发布流程的文章不能改派站点。
                </span>
              )}
            </label>
            <Button
              className="gf-console-focus disabled:cursor-wait"
              disabled={pending !== null || (!ownerChanged && !siteChanged)}
              onClick={() => void saveAssignment()}
              size="md"
              type="button"
            >
              <CheckCircleIcon size={15} />
              {pending === "save" ? "保存中…" : "保存分配"}
            </Button>
          </div>

          <div className="grid gap-3 border-t border-[var(--console-border)] pt-4">
            <span className="text-sm font-semibold text-[var(--console-ink)]">分发到其他站点</span>
            {variantSites.length === 0 ? (
              <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
                该内容已覆盖租户内全部站点。
              </p>
            ) : (
              <>
                <p className="m-0 text-xs leading-5 text-[var(--console-ink-muted)]">
                  勾选后为每个站点创建一份独立草稿（多站点分发按“一站点一版本”设计，各站点独立审核与发布）。
                </p>
                <div className="grid gap-2">
                  {variantSites.map((option) => (
                    <label
                      className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--console-ink)]"
                      key={option.id}
                    >
                      <input
                        checked={variantPicks.includes(option.id)}
                        className="gf-console-focus h-4 w-4 accent-indigo-600"
                        disabled={pending !== null}
                        onChange={(event) =>
                          setVariantPicks((current) =>
                            event.target.checked
                              ? [...current, option.id]
                              : current.filter((id) => id !== option.id),
                          )
                        }
                        type="checkbox"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <Button
                  className="gf-console-focus disabled:cursor-wait"
                  disabled={pending !== null || variantPicks.length === 0}
                  onClick={() => void createVariants()}
                  size="md"
                  type="button"
                  variant="secondary"
                >
                  <PlusIcon size={15} />
                  {pending === "variant"
                    ? "创建中…"
                    : `创建分发草稿${variantPicks.length > 0 ? `（${variantPicks.length}）` : ""}`}
                </Button>
              </>
            )}
          </div>
        </>
      ) : (
        <p className="m-0 border-t border-[var(--console-border)] pt-4 text-sm leading-6 text-[var(--console-ink-muted)]">
          当前角色只能查看分配；如需改派负责人或站点，请联络编辑或租户管理员。
        </p>
      )}
    </section>
  )
}

export default ArticleAssignmentPanel
