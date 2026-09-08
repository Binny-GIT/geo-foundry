import { ContentServiceClient } from "@geo/content-client"

import { createWorkerAiProvider } from "./config/ai-provider.js"
import { workerCredentialOf } from "./config/credentials.js"
import { loadTenantKeyring, runForTenant, tenantClientProxy } from "./config/tenant-keyring.js"
import { createSnapshotStore } from "./intake/snapshot-store.js"
import { createIntakeProcessor } from "./processors/intake.js"
import {
  createEvaluationProcessor,
  createGenerationProcessor,
} from "./processors/pipeline-processors.js"
import {
  createEmbeddingProcessor,
  createPublishGateProcessor,
  createRollbackGateProcessor,
} from "./processors/triggers.js"
import { parseWorkerS3Options } from "./processors/release-pipeline.js"
import type { WorkJob, WorkerLogEvent } from "./processors/types.js"
import {
  createWorkerBoss,
  CRON_SCHEDULES,
  JOB_QUEUE,
  QUEUE_CONCURRENCY,
  workerPgConnectionString,
} from "./queues/pgboss.js"

type PgBossJob = { readonly id: string; readonly name: string; readonly data: unknown }

/** v12 的 work handler 按批收到 Job 数组；逐个分派到旧处理器形状。 */
type ShapedJob = {
  readonly data: Record<string, unknown>
  readonly id: string
  readonly name: string
  readonly queueName: string
}

const handleJobs = (processor: (job: ShapedJob) => Promise<unknown>) =>
  async (jobs: readonly PgBossJob[]): Promise<void> => {
    for (const job of jobs) {
      const data = (job.data ?? {}) as Record<string, unknown>
      const stage = typeof data["stage"] === "string" ? data["stage"] : "fetch"
      await runForTenant(
        typeof data["tenantId"] === "number" && Number.isInteger(data["tenantId"])
          ? data["tenantId"]
          : undefined,
        async () =>
          processor({
            data: data as never,
            id: job.id,
            name: stage,
            queueName: job.name,
          }),
      )
    }
  }

/** Worker daemon entry for deterministic queues and explicitly configured AI providers. */
export const main = async (): Promise<void> => {
  const logger = (event: WorkerLogEvent) =>
    console.log(JSON.stringify({ at: new Date().toISOString(), ...event }))
  const credential = (name: string): string => workerCredentialOf(process.env, name)
  const tenantKeyring = loadTenantKeyring(process.env)
  const client = tenantClientProxy(
    tenantKeyring,
    process.env["CMS_BASE_URL"] ?? "http://127.0.0.1:3090",
  )
  const provider = createWorkerAiProvider(process.env, credential, (event) =>
    logger({
      code: `worker.ai.${event.type}`,
      detail: {
        ...(event.code === undefined ? {} : { code: event.code }),
        ...(event.latencyMs === undefined ? {} : { latencyMs: event.latencyMs }),
        method: event.method,
        model: event.model,
        providerId: event.providerId,
        requestId: event.requestId,
        status: event.status,
      },
      jobId: null,
      queue: JOB_QUEUE.generation,
    }),
  )
  const context = { client, logger }
  const publish = createPublishGateProcessor(context)
  const rollback = createRollbackGateProcessor(context)
  const snapshots = createSnapshotStore(parseWorkerS3Options(process.env, credential))
  const sendIntakeJob = async (input: { intakeItemId: number; tenantId: number }) => {
    // 子项入队经 CMS internal API 之外的直达路径已不存在；复用 dispatch 侧的
    // pg-boss 直连（受限 role 只能 INSERT pgboss.job，与 CMS 同队列同去重键）。
    await bossSend(JOB_QUEUE.intake, {
      intakeItemId: input.intakeItemId,
      kind: "intake",
      tenantId: input.tenantId,
    }, `intake-${input.intakeItemId}`)
  }
  // 处理器各自的 data 形状由运行时 data.stage/kind 分派，这里只保留统一外壳；
  // never 参数位让各具体处理器形状都能落入同一张表。
  const processors: Readonly<Record<string, (job: never) => Promise<unknown>>> = {
    [JOB_QUEUE.embedding]: createEmbeddingProcessor(context, provider),
    [JOB_QUEUE.evaluation]: createEvaluationProcessor(context, provider),
    [JOB_QUEUE.generation]: createGenerationProcessor(context, provider),
    [JOB_QUEUE.intake]: createIntakeProcessor({
      client,
      enqueue: sendIntakeJob,
      logger,
      snapshots,
    }),
    [JOB_QUEUE.publish]: (job: Parameters<typeof publish>[0]) =>
      ((job.data as Record<string, unknown>)["stage"] === "rollback-gate"
        ? rollback(job)
        : publish(job)) as Promise<unknown>,
  }

  const boss = createWorkerBoss({ connectionString: workerPgConnectionString() })
  const bossSend = async (
    queue: string,
    data: Record<string, unknown>,
    singletonKey: string,
  ): Promise<string | null> => boss.send(queue, data, { singletonKey })

  await boss.start()
  for (const [queue, processor] of Object.entries(processors)) {
    await boss.work(
      queue,
      { batchSize: QUEUE_CONCURRENCY[queue] ?? 1 },
      handleJobs(processor as (job: ShapedJob) => Promise<unknown>),
    )
  }

  // 定时面：每分钟驱动 CMS 的 dispatch-due / poll-due（幂等，多实例单触发）。
  await boss.createQueue(JOB_QUEUE.maintenance, { policy: "short" }).catch(() => undefined)
  await boss.work(JOB_QUEUE.maintenance, { batchSize: 1 }, async (jobs: readonly PgBossJob[]) => {
    for (const job of jobs) {
      const kind = (job.data as Record<string, unknown>)["kind"]
      if (kind === "publication-dispatch-due") {
        for (const tenantId of tenantKeyring.keys()) {
          await runForTenant(tenantId, async () =>
            client.dispatchDuePublicationPlans({
              now: new Date().toISOString(),
              workerId: `worker-${process.pid}`,
            }),
          )
        }
        continue
      }
      if (kind === "rss-poll-due") {
        for (const tenantId of tenantKeyring.keys()) {
          await runForTenant(tenantId, async () => client.pollDueConnectors())
        }
      }
    }
  })
  for (const schedule of CRON_SCHEDULES) {
    await boss.schedule(schedule.name, schedule.cron, { kind: schedule.name }, { tz: "UTC" })
  }

  const shutdown = async () => {
    await boss.stop()
    snapshots.close()
    process.exit(0)
  }
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
}

if (process.argv[1]?.endsWith("main.js") === true) {
  void main()
}
