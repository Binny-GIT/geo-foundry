import { ReleaseV1 } from "@geo/schema"
import { describe, expect, expectTypeOf, it } from "vitest"
import {
  type CompareAndSwapCurrentPointerRequest,
  type CompareAndSwapCurrentPointerWrite,
  type CreateCurrentPointerRequest,
  type CreateIfAbsentRequest,
  prepareCurrentPointerCompareAndSwap,
  prepareCurrentPointerInitialCreate,
} from "../src/index.js"

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

async function createPointer(): Promise<ReleaseV1.CurrentPointer> {
  const release = await ReleaseV1.verifyManifest(manifest)
  return ReleaseV1.createCurrentPointer({
    actor: ReleaseV1.AuditActorSchema.parse({
      actorId: "service-publisher",
      kind: "service",
    }),
    release,
    updatedAt: ReleaseV1.CanonicalTimestampSchema.parse("2026-08-17T10:05:00.000Z"),
  })
}

describe("ArtifactStore 对抗性公共契约", () => {
  it("通用 createIfAbsent 仅接受不可变发布对象键", () => {
    // Given：通用创建请求和不可变发布对象键类型。
    // When：检查公开请求的 key 类型。
    // Then：current 指针键不能进入通用条件创建。
    expectTypeOf<CreateIfAbsentRequest["key"]>().toEqualTypeOf<ReleaseV1.ReleaseObjectKey>()
  })

  it("current 指针初始创建是独立且无覆盖字段的操作", () => {
    // Given：专用初始创建请求。
    // When：检查其全部调用方可控字段。
    // Then：调用方只能提交已验证指针，不能提交 key、body 或 SHA。
    expectTypeOf<keyof CreateCurrentPointerRequest>().toEqualTypeOf<"pointer">()
  })

  it("CAS 请求不允许调用方提供矛盾的 key、body 或 SHA", () => {
    // Given：current 指针 CAS 请求。
    // When：检查其全部调用方可控字段。
    // Then：不匹配状态在类型上不可表示。
    expectTypeOf<keyof CompareAndSwapCurrentPointerRequest>().toEqualTypeOf<
      "expectedEtag" | "pointer"
    >()
  })

  it("初始创建与 CAS 从已验证指针派生相同规范字节和哈希", async () => {
    // Given：真实清单验证操作授权的 current 指针。
    const pointer = await createPointer()
    const expectedEtag = ReleaseV1.ETagSchema.parse('"etag-current"')

    // When：分别准备初始创建与 CAS 存储条件。
    const initialCreate = await prepareCurrentPointerInitialCreate({ pointer })
    const compareAndSwap = await prepareCurrentPointerCompareAndSwap({ expectedEtag, pointer })

    // Then：两种操作的内容身份只由指针派生，且 CAS 保留 RustFS If-Match 前置条件。
    expect(initialCreate.body).toEqual(compareAndSwap.body)
    expect(initialCreate.sha256).toBe(compareAndSwap.sha256)
    expect(initialCreate.key).toBe("sites/site-a/channels/current.json")
    expect(initialCreate.condition).toBe(ReleaseV1.ARTIFACT_CREATE_CONDITION)
    expect(compareAndSwap).toMatchObject({ condition: "if-match", expectedEtag })
    expect(compareAndSwap.sha256).toBe(await ReleaseV1.hashCurrentPointer(pointer))
  })

  it("CAS 忽略运行时注入的矛盾 body、SHA 和 key 并重新派生", async () => {
    // Given：绕过静态类型并注入矛盾存储字段的 CAS 请求。
    const pointer = await createPointer()
    const expectedEtag = ReleaseV1.ETagSchema.parse('"etag-current"')
    const attackerSha = ReleaseV1.Sha256Schema.parse(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    const injectedRequest = {
      body: Uint8Array.of(115, 112, 111, 111, 102, 101, 100),
      expectedEtag,
      key: "sites/site-b/channels/current.json",
      pointer,
      sha256: attackerSha,
    }

    // When：运行时调用规范 CAS 准备入口。
    const prepared: CompareAndSwapCurrentPointerWrite = await Reflect.apply(
      prepareCurrentPointerCompareAndSwap,
      undefined,
      [injectedRequest],
    )

    // Then：输出身份只来自已验证指针，攻击者字段均无效。
    expect(prepared.body).toEqual(ReleaseV1.serializeCurrentPointer(pointer))
    expect(prepared.sha256).not.toBe(attackerSha)
    expect(prepared.key).toBe("sites/site-a/channels/current.json")
  })
})
