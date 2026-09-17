/*
 * webhook 直投通道的纯规则测试：suggestedSiteId 必填、connector 解绑、
 * bodyMarkdown 只属于 webhook。数据库行为由 E2E 覆盖。
 */

import { describe, expect, it } from "vitest"

import {
  IntakeError,
  type NormalizedIntakeInput,
  normalizeIntakeInput,
} from "../../src/services/intake"

const baseInput = {
  summary: "一段摘要",
  suggestedSiteId: 374,
  tenantId: 413,
  title: "外部工具投稿标题",
}

const normalize = (input: Record<string, unknown>): NormalizedIntakeInput | IntakeError => {
  try {
    return normalizeIntakeInput({ channel: "webhook", ...input } as Parameters<
      typeof normalizeIntakeInput
    >[0])
  } catch (error) {
    return error as IntakeError
  }
}

const codeOf = (result: NormalizedIntakeInput | IntakeError): string | null =>
  result instanceof IntakeError ? result.code : null

describe("webhook direct-drop channel rules", () => {
  it("Given a webhook submission with bodyMarkdown and a site, when normalized, then it passes with the body carried through", () => {
    const result = normalize({ ...baseInput, bodyMarkdown: "# 标题\n\n正文。" })
    expect(codeOf(result)).toBeNull()
    expect(result instanceof IntakeError ? null : result.bodyMarkdown).toBe("# 标题\n\n正文。")
  })

  it("Given a webhook submission without suggestedSiteId, when normalized, then it is rejected", () => {
    const { suggestedSiteId: _omitted, ...withoutSite } = baseInput
    expect(codeOf(normalize(withoutSite))).toBe("INTAKE_SUGGESTED_SITE_REQUIRED")
  })

  it("Given a webhook submission without connectorId, when normalized, then it is accepted", () => {
    /* webhook 是直投通道：外部工具不需要先建 connector。 */
    const result = normalize({ ...baseInput })
    expect(codeOf(result)).toBeNull()
  })

  it("Given an empty bodyMarkdown, when normalized, then it is rejected rather than stored as an empty body", () => {
    expect(codeOf(normalize({ ...baseInput, bodyMarkdown: "   " }))).toBe(
      "INTAKE_BODY_MARKDOWN_EMPTY",
    )
  })

  it("Given bodyMarkdown on a non-webhook channel, when normalized, then it is rejected", () => {
    const attempt = (): unknown =>
      normalizeIntakeInput({
        bodyMarkdown: "# 内容",
        channel: "url",
        sourceUrl: "https://example.com/a",
        suggestedSiteId: 374,
        tenantId: 413,
        title: "标题",
      })
    expect(attempt).toThrow(IntakeError)
    expect(attempt).toThrow("INTAKE_BODY_MARKDOWN_CHANNEL_INVALID")
  })

  it("Given the rss channel, when normalized without connectorId, then it still requires a connector", () => {
    const attempt = (): unknown =>
      normalizeIntakeInput({
        channel: "rss",
        suggestedSiteId: 374,
        tenantId: 413,
        title: "标题",
      })
    expect(attempt).toThrow("INTAKE_CONNECTOR_REQUIRED")
  })
})
