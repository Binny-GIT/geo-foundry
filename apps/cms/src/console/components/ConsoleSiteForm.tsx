"use client"

import { useState } from "react"
import { consoleRoute } from "../lib/resources"
import {
  DEFAULT_SITE_FORM_VALUES,
  type SiteFormValues,
  siteMutationPayload,
} from "../lib/site-form"

type PayloadError = {
  readonly errors?: readonly { readonly message?: string }[]
  readonly message?: string
}

type StringListField =
  | "contentAngles"
  | "expertise"
  | "preferredTopics"
  | "prohibitedExpressions"
  | "prohibitedTopics"
  | "targetAudience"

type TextField = "cta" | "language" | "positioning" | "tone"

type ThresholdField =
  | "crossDomainBlock"
  | "crossDomainReview"
  | "dimensionMinimum"
  | "overallMinimum"
  | "sameSiteTitleBlock"

type SeoField = "defaultDescription" | "titleSuffix"

const errorMessage = (payload: PayloadError): string =>
  payload.errors?.find((error) => typeof error.message === "string")?.message ??
  payload.message ??
  "保存失败，请检查填写内容后重试。"

const listText = (values: readonly string[]): string => values.join("\n")

const textList = (value: string): string[] => value.split("\n")

const inputClass =
  "gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"

const textareaClass =
  "gf-console-focus min-h-28 resize-y rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 py-3 text-base leading-6 text-[var(--console-ink)] outline-none"

const ListField = ({
  description,
  label,
  onChange,
  value,
}: {
  readonly description: string
  readonly label: string
  readonly onChange: (value: string[]) => void
  readonly value: readonly string[]
}) => (
  <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
    {label}
    <textarea
      className={textareaClass}
      onChange={(event) => onChange(textList(event.target.value))}
      placeholder="每行一项"
      value={listText(value)}
    />
    <small className="font-normal leading-5 text-[var(--console-ink-muted)]">{description}</small>
  </label>
)

export const ConsoleSiteForm = ({
  id,
  initialValues = DEFAULT_SITE_FORM_VALUES,
  mode,
}: {
  readonly id?: string
  readonly initialValues?: SiteFormValues
  readonly mode: "create" | "edit"
}) => {
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<SiteFormValues>(initialValues)
  const [loading, setLoading] = useState(false)

  const updateContentText = (field: TextField, value: string) => {
    setForm((current) => ({
      ...current,
      contentStrategy: { ...current.contentStrategy, [field]: value },
    }))
  }

  const updateContentList = (field: StringListField, value: string[]) => {
    setForm((current) => ({
      ...current,
      contentStrategy: { ...current.contentStrategy, [field]: value },
    }))
  }

  const updateThreshold = (field: ThresholdField, value: string) => {
    setForm((current) => ({
      ...current,
      qualityThresholds: { ...current.qualityThresholds, [field]: value },
    }))
  }

  const updateSeo = (field: SeoField, value: string) => {
    setForm((current) => ({
      ...current,
      seoDefaults: { ...current.seoDefaults, [field]: value },
    }))
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const result = siteMutationPayload(form)
    if (!result.ok) {
      setError(result.errors[0] ?? "请检查填写内容后重试。")
      return
    }

    setLoading(true)
    try {
      const response = await fetch(
        mode === "create" ? "/api/sites" : `/api/sites/${encodeURIComponent(id ?? "")}`,
        {
          body: JSON.stringify(result.data),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: mode === "create" ? "POST" : "PATCH",
        },
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as PayloadError
        setError(errorMessage(payload))
        return
      }
      window.location.assign(
        mode === "create"
          ? consoleRoute.collection("sites")
          : consoleRoute.document("sites", id ?? ""),
      )
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  const cancelHref =
    mode === "create" ? consoleRoute.collection("sites") : consoleRoute.document("sites", id ?? "")

  return (
    <form className="grid gap-8" onSubmit={submit}>
      <fieldset className="grid gap-5">
        <legend className="mb-4 text-base font-semibold text-[var(--console-ink)]">基本设置</legend>
        <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
          站点名称
          <input
            autoComplete="organization"
            className={inputClass}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="例如：Northstar Media"
            required
            value={form.name}
          />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            区域设置
            <input
              autoCapitalize="none"
              autoComplete="off"
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({ ...current, locale: event.target.value }))
              }
              placeholder="en-US"
              required
              value={form.locale}
            />
            <small className="font-normal leading-5 text-[var(--console-ink-muted)]">
              使用规范 BCP-47 标签，例如 en-US。
            </small>
          </label>
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            时区
            <input
              autoCapitalize="none"
              autoComplete="off"
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({ ...current, timezone: event.target.value }))
              }
              placeholder="America/New_York"
              required
              value={form.timezone}
            />
            <small className="font-normal leading-5 text-[var(--console-ink-muted)]">
              使用规范 IANA 时区名称，例如 America/New_York。
            </small>
          </label>
        </div>
        <label className="grid max-w-sm gap-2 text-sm font-medium text-[var(--console-ink)]">
          状态
          <select
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value === "disabled" ? "disabled" : "active",
              }))
            }
            value={form.status}
          >
            <option value="active">启用</option>
            <option value="disabled">停用</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="grid gap-5 border-t border-[var(--console-border)] pt-7">
        <legend className="mb-4 text-base font-semibold text-[var(--console-ink)]">内容策略</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            定位
            <input
              className={inputClass}
              onChange={(event) => updateContentText("positioning", event.target.value)}
              value={form.contentStrategy.positioning}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            语调
            <input
              className={inputClass}
              onChange={(event) => updateContentText("tone", event.target.value)}
              value={form.contentStrategy.tone}
            />
          </label>
        </div>
        <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
          内容语言
          <input
            className={inputClass}
            onChange={(event) => updateContentText("language", event.target.value)}
            value={form.contentStrategy.language}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
          主要行动号召
          <input
            className={inputClass}
            onChange={(event) => updateContentText("cta", event.target.value)}
            placeholder="例如：预约咨询"
            value={form.contentStrategy.cta}
          />
          <small className="font-normal leading-5 text-[var(--console-ink-muted)]">
            内容在需要引导下一步时使用的主要行动号召。
          </small>
        </label>
        <div className="grid gap-5 lg:grid-cols-2">
          <ListField
            description="每行一个目标受众。"
            label="目标受众"
            onChange={(value) => updateContentList("targetAudience", value)}
            value={form.contentStrategy.targetAudience}
          />
          <ListField
            description="每行一个专业领域。"
            label="专业领域"
            onChange={(value) => updateContentList("expertise", value)}
            value={form.contentStrategy.expertise}
          />
          <ListField
            description="每行一个优先主题。"
            label="优先主题"
            onChange={(value) => updateContentList("preferredTopics", value)}
            value={form.contentStrategy.preferredTopics}
          />
          <ListField
            description="每行一个禁止主题。"
            label="禁止主题"
            onChange={(value) => updateContentList("prohibitedTopics", value)}
            value={form.contentStrategy.prohibitedTopics}
          />
          <ListField
            description="每行一个不能使用的措辞或表达。"
            label="禁止表达"
            onChange={(value) => updateContentList("prohibitedExpressions", value)}
            value={form.contentStrategy.prohibitedExpressions}
          />
          <ListField
            description="每行一个内容角度。"
            label="内容角度"
            onChange={(value) => updateContentList("contentAngles", value)}
            value={form.contentStrategy.contentAngles}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-5 border-t border-[var(--console-border)] pt-7">
        <legend className="mb-4 text-base font-semibold text-[var(--console-ink)]">质量阈值</legend>
        <p className="-mt-3 m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
          跨域与同站标题阈值为 0 至 1；质量最低分为 0 至 100。
        </p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["crossDomainBlock", "跨域拦截阈值", "0 至 1"],
              ["crossDomainReview", "跨域审核阈值", "0 至 1"],
              ["sameSiteTitleBlock", "同站标题拦截阈值", "0 至 1"],
              ["overallMinimum", "总体最低分", "0 至 100"],
              ["dimensionMinimum", "维度最低分", "0 至 100"],
            ] as const
          ).map(([field, label, hint]) => (
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]" key={field}>
              {label}
              <input
                className={inputClass}
                inputMode="decimal"
                min={0}
                max={field === "overallMinimum" || field === "dimensionMinimum" ? 100 : 1}
                onChange={(event) => updateThreshold(field, event.target.value)}
                step="any"
                type="number"
                value={form.qualityThresholds[field]}
              />
              <small className="font-normal leading-5 text-[var(--console-ink-muted)]">
                {hint}
              </small>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-5 border-t border-[var(--console-border)] pt-7">
        <legend className="mb-4 text-base font-semibold text-[var(--console-ink)]">
          SEO 默认值
        </legend>
        <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
          标题后缀
          <input
            className={inputClass}
            onChange={(event) => updateSeo("titleSuffix", event.target.value)}
            value={form.seoDefaults.titleSuffix}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
          默认描述
          <textarea
            className={textareaClass}
            onChange={(event) => updateSeo("defaultDescription", event.target.value)}
            value={form.seoDefaults.defaultDescription}
          />
        </label>
      </fieldset>

      {error !== null && (
        <p
          className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-6 text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--console-border)] pt-5">
        <a
          className="gf-console-focus inline-flex h-11 items-center justify-center rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-4 text-sm font-semibold text-[var(--console-ink)] no-underline hover:bg-[var(--console-surface-muted)]"
          href={cancelHref}
        >
          取消
        </a>
        <button
          className="gf-console-focus inline-flex h-11 items-center justify-center rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--console-accent-hover)] disabled:cursor-wait disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading
            ? mode === "create"
              ? "正在创建…"
              : "正在保存…"
            : mode === "create"
              ? "创建站点"
              : "保存更改"}
        </button>
      </div>
    </form>
  )
}
