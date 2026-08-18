import { describe, expect, it } from "vitest"

import { ReleaseIdSchema, ReleaseV1, SiteIdSchema } from "../src/index.js"

const actor = ReleaseV1.AuditActorSchema.parse({ actorId: "service-publisher", kind: "service" })
const updatedAt = ReleaseV1.CanonicalTimestampSchema.parse("2026-08-17T10:05:00.000Z")
const expectedArtifact = ReleaseV1.ImmutableArtifactSchema.parse({
  bytes: 128,
  contentType: "application/json",
  path: "pages/en-US/index.json",
  sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
})
const manifest = {
  compilerVersion: "1.0.0",
  createdAt: "2026-08-17T10:00:00.000Z",
  objects: [
    expectedArtifact,
    {
      bytes: 64,
      contentType: "image/svg+xml",
      path: "assets/logo.svg",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ],
  releaseId: "release-001",
  schemaVersion: 1,
  siteId: "site-a",
  sourceVersionIds: ["source-001", "source-002"],
} as const

describe("Release v1 分支覆盖契约", () => {
  it.each([
    {
      code: "ARTIFACT_PATH_MISMATCH",
      field: "path",
      observed: { ...expectedArtifact, path: "pages/en-US/other.json" },
    },
    {
      code: "ARTIFACT_BYTES_MISMATCH",
      field: "bytes",
      observed: { ...expectedArtifact, bytes: 129 },
    },
    {
      code: "ARTIFACT_SHA256_MISMATCH",
      field: "sha256",
      observed: {
        ...expectedArtifact,
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    },
    {
      code: "ARTIFACT_CONTENT_TYPE_MISMATCH",
      field: "contentType",
      observed: { ...expectedArtifact, contentType: "text/html" },
    },
  ])("拒绝不可变对象的 $field 变化", ({ code, field, observed }) => {
    // Given：远端观测值仅改变一个不可变字段。
    // When：验证清单对象与观测值的一致性。
    const verify = () => ReleaseV1.verifyArtifactObservation(expectedArtifact, observed)

    // Then：对应字段和稳定错误码被报告。
    expect(verify).toThrow(ReleaseV1.ArtifactIntegrityError)
    try {
      verify()
      expect.unreachable("被修改的对象通过了完整性验证")
    } catch (error) {
      expect(error).toMatchObject({ code, field })
    }
  })

  it("接受完全一致的不可变对象观测值", () => {
    // Given：远端观测值与清单对象一致。
    // When：验证对象完整性。
    const observed = ReleaseV1.verifyArtifactObservation(expectedArtifact, expectedArtifact)

    // Then：返回严格解析后的冻结观测值。
    expect(observed).toEqual(expectedArtifact)
    expect(Object.isFrozen(observed)).toBe(true)
  })

  it("覆盖规范排序的两个比较方向并拒绝重复来源版本", () => {
    // Given：对象顺序已升序且来源版本重复的清单。
    const ordered = { ...manifest, objects: [...manifest.objects].reverse() }
    const duplicateSource = {
      ...manifest,
      sourceVersionIds: ["source-001", "source-001"],
    }

    // When：分别规范化排序并验证重复来源。
    const canonical = ReleaseV1.canonicalizeReleaseManifest(ordered)
    const duplicateResult = ReleaseV1.ReleaseManifestSchema.safeParse(duplicateSource)

    // Then：排序保持规范顺序，重复来源以稳定错误码失败。
    expect(canonical.objects.map(({ path }) => path)).toEqual([
      "assets/logo.svg",
      "pages/en-US/index.json",
    ])
    expect(duplicateResult.success).toBe(false)
    if (!duplicateResult.success) {
      expect(duplicateResult.error.issues).toContainEqual(
        expect.objectContaining({ message: "RELEASE_SOURCE_VERSION_DUPLICATE" }),
      )
    }
  })

  it("构造所有受约束的发布对象键", () => {
    // Given：规范站点、发布和对象路径标识。
    const siteId = SiteIdSchema.parse("site-a")
    const releaseId = ReleaseIdSchema.parse("release-001")
    const path = ReleaseV1.ReleaseArtifactPathSchema.parse("pages/en-US/index.json")

    // When：构造对象键、清单键、指针键和发布前缀。
    const keys = [
      ReleaseV1.releaseArtifactKey(siteId, releaseId, path),
      ReleaseV1.releaseManifestKey(siteId, releaseId),
      ReleaseV1.currentPointerKey(siteId),
      ReleaseV1.releasePrefix(siteId, releaseId),
    ]

    // Then：所有键均限定在同一站点发布命名空间。
    expect(keys).toEqual([
      "sites/site-a/releases/release-001/pages/en-US/index.json",
      "sites/site-a/releases/release-001/manifest.json",
      "sites/site-a/channels/current.json",
      "sites/site-a/releases/release-001/",
    ])
  })

  it.each(["pointer", null, { releaseId: "release-001" }])(
    "拒绝未授权指针值 %# 的规范序列化",
    (untrustedPointer) => {
      // Given：未由清单验证链创建的运行时值。
      // When：绕过静态类型调用指针序列化入口。
      const serialize = () =>
        Reflect.apply(ReleaseV1.serializeCurrentPointer, undefined, [untrustedPointer])

      // Then：私有实例证明拒绝该值。
      expect(serialize).toThrow(ReleaseV1.UnverifiedReleasePointerError)
    },
  )

  it("规范序列化并哈希真实验证链创建的指针", async () => {
    // Given：真实清单验证证明授权的 current 指针。
    const release = await ReleaseV1.verifyManifest(manifest)
    const pointer = ReleaseV1.createCurrentPointer({ actor, release, updatedAt })

    // When：序列化并计算指针内容身份。
    const body = ReleaseV1.serializeCurrentPointer(pointer)
    const sha256 = await ReleaseV1.hashCurrentPointer(pointer)

    // Then：输出是无私有品牌泄漏的规范 JSON 和有效 SHA-256。
    expect(JSON.parse(new TextDecoder().decode(body))).toEqual(
      ReleaseV1.CurrentPointerSchema.parse(pointer),
    )
    expect(ReleaseV1.Sha256Schema.safeParse(sha256).success).toBe(true)
  })

  it("构造不可达契约错误供边界识别", () => {
    // Given：发布契约内部不可达状态错误。
    // When：实例化类型化错误。
    const error = new ReleaseV1.ReleaseContractInvariantError()

    // Then：错误保留稳定名称和机器码。
    expect(error).toMatchObject({
      code: "RELEASE_CONTRACT_UNREACHABLE",
      name: "ReleaseContractInvariantError",
    })
  })
})
