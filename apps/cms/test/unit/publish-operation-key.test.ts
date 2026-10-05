import { describe, expect, it } from "vitest"

import { publishOperationBaseKeyOf } from "../../src/server/repositories/publish-operations"

describe("publishOperationBaseKeyOf", () => {
  const firstVersion = {
    compiledRelease: null,
    editionId: 869,
    revision: 1,
    siteId: 498,
    versionId: 1201,
  } as const

  it("Given 已发布文章的新版本修订号重新从 1 开始, when 计算发布幂等键, then 与旧版本的键不同", () => {
    const nextVersion = { ...firstVersion, versionId: 1207 }

    expect(publishOperationBaseKeyOf(nextVersion)).not.toBe(publishOperationBaseKeyOf(firstVersion))
  })

  it("Given 同一版本同一修订号重复提交, when 计算发布幂等键, then 键相同以保持幂等回放", () => {
    expect(publishOperationBaseKeyOf({ ...firstVersion })).toBe(
      publishOperationBaseKeyOf(firstVersion),
    )
  })

  it("Given 同一版本发往不同站点, when 计算发布幂等键, then 各站互不干扰", () => {
    expect(publishOperationBaseKeyOf({ ...firstVersion, siteId: 391 })).not.toBe(
      publishOperationBaseKeyOf(firstVersion),
    )
  })

  it("Given 版本已编译出 release, when 计算发布幂等键, then 以编译 release 为键", () => {
    expect(
      publishOperationBaseKeyOf({
        ...firstVersion,
        compiledRelease: "rel-0123456789abcdef01234567",
      }),
    ).toBe("publish-edition-869-site-498-rel-0123456789abcdef01234567")
  })
})
