import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { acquireSharedServiceLock, deriveSharedServiceNamespace } from "../../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("共享服务测试隔离抽象", () => {
  it("在给定 run ID 时仅派生项目拥有的命名空间", () => {
    // Given
    const runId = "task-7-manual"

    // When
    const namespace = deriveSharedServiceNamespace(runId)

    // Then
    expect(namespace).toEqual({
      postgres: {
        database: "geo_foundry",
        schema: "geo_foundry",
        tablePrefix: "test_task_7_manual_",
      },
      redis: { prefix: "geo-foundry:task-7-manual:" },
      runId,
      s3: { bucket: "geo-foundry", prefix: "objects/task-7-manual/" },
    })
  })

  it("在项目锁已占用时快速失败并在释放后允许重新获取", async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "geo-foundry-lock-"))
    temporaryDirectories.push(directory)
    const release = await acquireSharedServiceLock({ directory, runId: "task-7-first" })

    // When
    const collision = acquireSharedServiceLock({ directory, runId: "task-7-second" })

    // Then
    await expect(collision).rejects.toMatchObject({ code: "SHARED_SERVICE_LOCK_COLLISION" })
    await release()
    const releaseAgain = await acquireSharedServiceLock({ directory, runId: "task-7-third" })
    await releaseAgain()
  })
})
