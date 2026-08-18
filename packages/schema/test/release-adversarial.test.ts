import { describe, expect, it } from "vitest"

import { ReleaseV1 } from "../src/index.js"

const manifest = {
  compilerVersion: "1.0.0",
  createdAt: "2026-08-17T10:00:00.000Z",
  objects: [
    {
      bytes: 128,
      contentType: "application/json",
      path: "pages/en-US/index.json",
      sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  ],
  releaseId: "release-001",
  schemaVersion: 1,
  siteId: "site-a",
  sourceVersionIds: ["source-001"],
} as const

const actor = ReleaseV1.AuditActorSchema.parse({ actorId: "user-mark", kind: "user" })

describe("Release v1 对抗性契约", () => {
  it.each([
    "2026-13-17T10:00:00.000Z",
    "2026-02-30T10:00:00.000Z",
    "2025-02-29T10:00:00.000Z",
    "2026-08-17T24:00:00.000Z",
    "2026-08-17T10:60:00.000Z",
    "2026-08-17T10:00:60.000Z",
  ])("拒绝语义无效的 ISO UTC 时间戳 %s", (timestamp) => {
    // Given：格式看似规范但日历或时钟字段越界的 UTC 时间戳。
    // When：时间戳跨越发布契约边界。
    const result = ReleaseV1.CanonicalTimestampSchema.safeParse(timestamp)

    // Then：语义无效值不能进入发布清单、指针或回执。
    expect(result.success).toBe(false)
  })

  it("接受真实存在的闰日 ISO UTC 时间戳", () => {
    // Given：公历闰年的二月二十九日。
    // When：时间戳跨越发布契约边界。
    const result = ReleaseV1.CanonicalTimestampSchema.safeParse("2024-02-29T23:59:59.999Z")

    // Then：真实日历时间保持可用。
    expect(result.success).toBe(true)
  })

  it("拒绝调用方伪造 verified 状态创建 current 指针", () => {
    // Given：调用方仅提交一个结构上声称已验证的普通对象。
    const spoofedCandidate = {
      actor,
      release: {
        manifestSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        releaseId: "release-001",
        siteId: "site-a",
        verificationStatus: "verified",
      },
      updatedAt: ReleaseV1.CanonicalTimestampSchema.parse("2026-08-17T10:05:00.000Z"),
    }

    // When：绕过 TypeScript 后直接调用运行时入口。
    const create = () =>
      Reflect.apply(ReleaseV1.createCurrentPointer, undefined, [spoofedCandidate])

    // Then：没有真实清单验证证明的对象不能授权指针。
    expect(create).toThrow(ReleaseV1.UnverifiedReleasePointerError)
  })

  it("仅允许 verifyManifest 产生的证明授权 current 指针", async () => {
    // Given：一个通过严格 schema 的真实发布清单。
    const verifiedRelease = await ReleaseV1.verifyManifest(manifest)

    // When：使用不透明验证证明创建指针。
    const pointer = ReleaseV1.createCurrentPointer({
      actor,
      release: verifiedRelease,
      updatedAt: ReleaseV1.CanonicalTimestampSchema.parse("2026-08-17T10:05:00.000Z"),
    })

    // Then：指针身份来自规范清单，而不是调用方提供的状态字符串。
    expect(pointer).toMatchObject({
      manifestSha256: await ReleaseV1.hashReleaseManifest(manifest),
      releaseId: manifest.releaseId,
      siteId: manifest.siteId,
    })
  })

  it("拒绝复制真实证明全部可枚举字段和私有 Symbol 的克隆对象", async () => {
    // Given：真实验证证明的浅克隆包含相同字符串字段和 Symbol 属性。
    const verifiedRelease = await ReleaseV1.verifyManifest(manifest)
    const clonedRelease = Object.assign({}, verifiedRelease)
    const candidate = {
      actor,
      release: clonedRelease,
      updatedAt: ReleaseV1.CanonicalTimestampSchema.parse("2026-08-17T10:05:00.000Z"),
    }

    // When：克隆对象尝试授权 current 指针。
    const create = () => Reflect.apply(ReleaseV1.createCurrentPointer, undefined, [candidate])

    // Then：模块私有实例证明拒绝复制品牌的旁路攻击。
    expect(create).toThrow(ReleaseV1.UnverifiedReleasePointerError)
  })

  it("不可变发布对象键拒绝 current 指针键", () => {
    // Given：current 指针专用对象键。
    const pointerKey = "sites/site-a/channels/current.json"

    // When：尝试把它解析为通用条件创建可接受的不可变发布对象键。
    const result = ReleaseV1.ReleaseObjectKeySchema.safeParse(pointerKey)

    // Then：指针键只能进入专用初始创建或 CAS 操作。
    expect(result.success).toBe(false)
  })
})
