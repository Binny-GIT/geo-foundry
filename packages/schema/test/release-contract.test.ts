import { describe, expect, it } from "vitest"

import { ReleaseV1 } from "../src/index.js"

const hashes = {
  asset: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  manifest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  page: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
} as const

const actor = { actorId: "user-mark", kind: "user" } as const

const unorderedManifest = {
  compilerVersion: "1.0.0",
  createdAt: "2026-08-17T10:00:00.000Z",
  objects: [
    {
      bytes: 128,
      contentType: "application/json",
      path: "pages/en-US/index.json",
      sha256: hashes.page,
    },
    {
      bytes: 64,
      contentType: "image/svg+xml",
      path: "assets/logo.svg",
      sha256: hashes.asset,
    },
  ],
  releaseId: "release-001",
  schemaVersion: 1,
  siteId: "site-a",
  sourceVersionIds: ["source-002", "source-001"],
} as const

describe("ReleaseManifest v1 规范契约", () => {
  it("对无序对象清单生成相同字节与 SHA-256", async () => {
    // Given：两个仅数组顺序不同的发布清单。
    const reordered = {
      ...unorderedManifest,
      objects: [...unorderedManifest.objects].reverse(),
      sourceVersionIds: [...unorderedManifest.sourceVersionIds].reverse(),
    }

    // When：分别执行规范序列化与哈希。
    const firstBytes = ReleaseV1.serializeReleaseManifest(unorderedManifest)
    const secondBytes = ReleaseV1.serializeReleaseManifest(reordered)
    const firstHash = await ReleaseV1.hashReleaseManifest(unorderedManifest)
    const secondHash = await ReleaseV1.hashReleaseManifest(reordered)

    // Then：字节、哈希及清单排序完全一致。
    expect(firstBytes).toEqual(secondBytes)
    expect(firstHash).toBe(secondHash)
    expect(
      ReleaseV1.ReleaseManifestSchema.parse(unorderedManifest).objects.map(({ path }) => path),
    ).toEqual(["assets/logo.svg", "pages/en-US/index.json"])
  })

  it("拒绝重复对象路径", () => {
    // Given：同一路径出现两次的清单。
    const duplicate = {
      ...unorderedManifest,
      objects: [unorderedManifest.objects[0], unorderedManifest.objects[0]],
    }

    // When：清单跨越严格边界。
    const result = ReleaseV1.ReleaseManifestSchema.safeParse(duplicate)

    // Then：重复路径被稳定错误码拒绝。
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(({ message }) => message === "RELEASE_OBJECT_PATH_DUPLICATE"),
      ).toBe(true)
    }
  })

  it.each(["../secret.json", "pages/../../secret.json", "/absolute.json", "pages\\item.json"])(
    "拒绝越界对象路径 %s",
    (path) => {
      // Given：对象路径可逃离发布前缀。
      const traversal = {
        ...unorderedManifest,
        objects: [{ ...unorderedManifest.objects[0], path }],
      }

      // When：清单跨越严格边界。
      const result = ReleaseV1.ReleaseManifestSchema.safeParse(traversal)

      // Then：路径约束拒绝该对象。
      expect(result.success).toBe(false)
    },
  )

  it("限制 ArtifactStore 键为 site/release 与 current 指针命名空间", () => {
    // Given：一个规范发布键、一个规范指针键和两个越界键。
    const validKeys = [
      "sites/site-a/releases/release-001/pages/en-US/index.json",
      "sites/site-a/channels/current.json",
    ]
    const invalidKeys = [
      "sites/site-a/releases/release-001/pages/../../secret.json",
      "geo-foundry/objects/other-project/file.json",
    ]

    // When：键跨越 S3/RustFS 契约边界。
    const validResults = validKeys.map((key) => ReleaseV1.ArtifactStoreKeySchema.safeParse(key))
    const invalidResults = invalidKeys.map((key) => ReleaseV1.ArtifactStoreKeySchema.safeParse(key))

    // Then：仅允许项目内不可变发布对象与 current 指针。
    expect(validResults.every(({ success }) => success)).toBe(true)
    expect(invalidResults.every(({ success }) => !success)).toBe(true)
  })

  it("拒绝缺失 SHA-256 的对象", () => {
    // Given：对象元数据没有内容哈希。
    const missingHash = {
      ...unorderedManifest,
      objects: [
        {
          bytes: 128,
          contentType: "application/json",
          path: "pages/en-US/index.json",
        },
      ],
    }

    // When：清单跨越严格边界。
    const result = ReleaseV1.ReleaseManifestSchema.safeParse(missingHash)

    // Then：缺失哈希不可进入发布契约。
    expect(result.success).toBe(false)
  })

  it("拒绝已变更对象的远端观测值", () => {
    // Given：清单对象与远端 HEAD 的哈希不同。
    const expected = ReleaseV1.ImmutableArtifactSchema.parse(unorderedManifest.objects[0])
    const observed = {
      ...expected,
      sha256: hashes.asset,
    }

    // When：验证远端对象完整性。
    const verify = () => ReleaseV1.verifyArtifactObservation(expected, observed)

    // Then：调用方收到结构化完整性错误。
    expect(verify).toThrow(ReleaseV1.ArtifactIntegrityError)
    try {
      verify()
      expect.unreachable("已变更对象通过了完整性验证")
    } catch (error) {
      expect(error).toMatchObject({ code: "ARTIFACT_SHA256_MISMATCH", field: "sha256" })
    }
  })
})

describe("CurrentPointer 与回执 v1 严格契约", () => {
  it("拒绝指向未验证发布的当前指针", () => {
    // Given：发布引用明确处于未验证状态。
    const candidate = {
      actor,
      release: {
        manifestSha256: hashes.manifest,
        releaseId: "release-001",
        siteId: "site-a",
        verificationStatus: "unverified",
      },
      updatedAt: "2026-08-17T10:05:00.000Z",
    }

    // When：尝试创建当前指针。
    const create = () => Reflect.apply(ReleaseV1.createCurrentPointer, undefined, [candidate])

    // Then：未验证发布不能成为 current。
    expect(create).toThrow(ReleaseV1.UnverifiedReleasePointerError)
  })

  it("验证发布、当前指针及发布/回滚回执固定字段", () => {
    // Given：一组规范发布契约夹具。
    const fixtures = ReleaseV1.releaseContractFixtures

    // When：夹具通过各自的严格 schema。
    const parsed = [
      ReleaseV1.ReleaseManifestSchema.parse(fixtures.manifest),
      ReleaseV1.CurrentPointerSchema.parse(fixtures.pointer),
      ReleaseV1.PublishReceiptSchema.parse(fixtures.publishReceipt),
      ReleaseV1.RollbackReceiptSchema.parse(fixtures.rollbackReceipt),
    ]

    // Then：所有版本化值均被浅冻结且拒绝任意未知字段。
    expect(parsed.every(Object.isFrozen)).toBe(true)
    expect(
      ReleaseV1.PublishReceiptSchema.safeParse({ ...fixtures.publishReceipt, arbitrary: true })
        .success,
    ).toBe(false)
  })
})
