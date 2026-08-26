import { describe, expect, it } from "vitest"

import { ContentEditions } from "../../src/collections/ContentEditions"
import { Contents } from "../../src/collections/Contents"
import { Domains, validateHostnameField } from "../../src/collections/Domains"
import { IdempotencyRecords } from "../../src/collections/IdempotencyRecords"
import { Media } from "../../src/collections/Media"
import { Operations } from "../../src/collections/Operations"
import { OutboxEvents } from "../../src/collections/OutboxEvents"
import { QualityAssessments } from "../../src/collections/QualityAssessments"
import { Releases } from "../../src/collections/Releases"
import { RollbackIntents } from "../../src/collections/RollbackIntents"
import { Sites, validateLocaleField, validateTimezoneField } from "../../src/collections/Sites"
import { Tenants } from "../../src/collections/Tenants"
import { UrlRecords } from "../../src/collections/UrlRecords"
import { Users } from "../../src/collections/Users"
import {
  localized,
  localizedFields,
  localizedValidationMessage,
  requestLanguage,
} from "../../src/collections/shared/localized-labels"
import { validateEditionBody } from "../../src/editor/validate-body"

type Localized = Readonly<{ en: string; zh: string }>
type SchemaField = Readonly<{
  fields?: readonly SchemaField[]
  label?: unknown
  name?: string
  options?: readonly unknown[]
}>
type Schema = Readonly<{
  admin?: Readonly<{ group?: unknown }>
  fields: readonly SchemaField[]
  labels: Readonly<{ plural: unknown; singular: unknown }>
}>

const collections: readonly Schema[] = [
  Sites,
  Domains,
  ContentEditions,
  Releases,
  RollbackIntents,
  Media,
  Contents,
  QualityAssessments,
  Operations,
  Users,
  UrlRecords,
  Tenants,
  IdempotencyRecords,
  OutboxEvents,
]

const hasLocalizedCopy = (value: unknown): value is Localized =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>)["en"] === "string" &&
  typeof (value as Record<string, unknown>)["zh"] === "string"

const expectLocalizedFields = (fields: readonly SchemaField[]): void => {
  for (const field of fields) {
    if (field.name !== undefined) {
      expect(field.label).toSatisfy(hasLocalizedCopy)
    }
    if (field.options !== undefined) {
      for (const option of field.options) {
        if (typeof option === "object" && option !== null && "label" in option) {
          expect((option as { label: unknown }).label).toSatisfy(hasLocalizedCopy)
        }
      }
    }
    if (field.fields !== undefined) {
      expectLocalizedFields(field.fields)
    }
  }
}

const validationOptions = (language: "en" | "zh") => ({
  req: { i18n: { language } },
})

describe("CMS schema localization", () => {
  it("provides en/zh labels and admin groups for visible and diagnostic collections", () => {
    for (const collection of collections) {
      expect(collection.labels.singular).toSatisfy(hasLocalizedCopy)
      expect(collection.labels.plural).toSatisfy(hasLocalizedCopy)
      expect(collection.admin?.group).toSatisfy(hasLocalizedCopy)
      expectLocalizedFields(collection.fields)
    }
  })

  it("keeps media uploads local to the browser file picker", () => {
    expect(Media.upload?.pasteURL).toBe(false)
    expect(Media.admin?.components?.beforeList).toEqual([
      "/components/media/MediaUploadGuidance#MediaUploadGuidance",
    ])
  })

  it("localizes generated field and select-option labels without changing stored values", () => {
    expect(localized("Site", "站点")).toEqual({ en: "Site", zh: "站点" })
    expect(
      localizedFields([
        { name: "state", type: "select", options: ["pending"] },
        { name: "title", type: "text" },
      ]),
    ).toEqual([
      {
        name: "state",
        label: { en: "State", zh: "状态" },
        type: "select",
        options: [{ label: { en: "Pending", zh: "待处理" }, value: "pending" }],
      },
      { name: "title", label: { en: "Title", zh: "标题" }, type: "text" },
    ])
  })

  it("uses the current request language for schema validation messages", () => {
    expect(requestLanguage(validationOptions("en").req)).toBe("en")
    expect(requestLanguage(validationOptions("zh").req)).toBe("zh")
    expect(localizedValidationMessage(validationOptions("en").req, "English", "中文")).toBe(
      "English",
    )
    expect(localizedValidationMessage(validationOptions("zh").req, "English", "中文")).toBe("中文")

    expect(validateLocaleField("not a locale", validationOptions("en"))).toBe(
      "Locale must be a canonical BCP-47 tag",
    )
    expect(validateLocaleField("not a locale", validationOptions("zh"))).toBe(
      "区域设置必须是规范的 BCP-47 标签",
    )
    expect(validateTimezoneField("not/a-zone", validationOptions("en"))).toBe(
      "Timezone must be a canonical IANA zone",
    )
    expect(validateTimezoneField("not/a-zone", validationOptions("zh"))).toBe(
      "时区必须是规范的 IANA 时区名称",
    )
    expect(validateHostnameField("not a host", validationOptions("en"))).toBe(
      "Hostname must be a valid DNS hostname",
    )
    expect(validateHostnameField("not a host", validationOptions("zh"))).toBe(
      "主机名必须是有效的 DNS 主机名",
    )
    expect(validateEditionBody([], validationOptions("en"))).toBe(
      "Body must be a non-empty list of content blocks",
    )
    expect(validateEditionBody([], validationOptions("zh"))).toBe("正文必须是非空的内容区块列表")
  })
})
