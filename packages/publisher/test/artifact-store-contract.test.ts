import { ReleaseV1 } from "@geo/schema"
import { describe, expect, expectTypeOf, it } from "vitest"
import {
  type ArtifactStore,
  assertPointerEtagMatches,
  StalePointerEtagError,
} from "../src/index.js"

type ExpectedArtifactStoreMethod =
  | "compareAndSwapCurrentPointer"
  | "createCurrentPointer"
  | "createIfAbsent"
  | "head"
  | "list"
  | "read"

type ForbiddenArtifactStoreMethod = Extract<
  keyof ArtifactStore,
  "delete" | "overwrite" | "put" | "remove" | "write"
>

describe("ArtifactStore P0 公共契约", () => {
  it("仅暴露条件创建、读取、列举、HEAD 与指针 CAS", () => {
    // Given：P0 ArtifactStore 的公开类型。
    // When：消费者检查其全部方法键与禁止方法集合。
    // Then：API 精确等于六个允许操作，且不存在覆盖或删除逃逸口。
    expectTypeOf<keyof ArtifactStore>().toEqualTypeOf<ExpectedArtifactStoreMethod>()
    expectTypeOf<ForbiddenArtifactStoreMethod>().toEqualTypeOf<never>()
  })

  it("拒绝陈旧 ETag", () => {
    // Given：调用方持有旧 ETag，而存储返回了新 ETag。
    const expectedEtag = ReleaseV1.ETagSchema.parse('"etag-old"')
    const actualEtag = ReleaseV1.ETagSchema.parse('"etag-new"')

    // When：执行 CAS 前置契约检查。
    const assertMatch = () => assertPointerEtagMatches({ actualEtag, expectedEtag })

    // Then：陈旧值以类型化冲突错误失败。
    expect(assertMatch).toThrow(StalePointerEtagError)
    try {
      assertMatch()
      expect.unreachable("陈旧 ETag 通过了 CAS 检查")
    } catch (error) {
      expect(error).toMatchObject({
        actualEtag,
        code: "ARTIFACT_STORE_POINTER_ETAG_STALE",
        expectedEtag,
      })
    }
  })

  it("接受完全匹配的 ETag", () => {
    // Given：期望值与当前对象 ETag 相同。
    const etag = ReleaseV1.ETagSchema.parse('"etag-current"')

    // When：执行 CAS 前置契约检查。
    const matched = assertPointerEtagMatches({ actualEtag: etag, expectedEtag: etag })

    // Then：返回已验证 ETag 供适配器使用。
    expect(matched).toBe(etag)
  })
})
