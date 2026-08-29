import { ContentServiceClient } from "@geo/content-client"
import { intakeJobIdOf, parseQueuePrefix } from "@geo/domain"
import { FlowProducer, Queue } from "bullmq"

import { createWorkerAiProvider } from "./config/ai-provider.js"
import { workerCredentialOf } from "./config/credentials.js"
import { loadTenantKeyring, runForTenant, tenantClientProxy } from "./config/tenant-keyring.js"
import { parseWorkerRedisOptions } from "./config/redis.js"
import { createSnapshotStore } from "./intake/snapshot-store.js"
import { createIntakeProcessor } from "./processors/intake.js"
import { createOutboxProcessor } from "./processors/outbox.js"
import {
  createEvaluationProcessor,
  createGenerationProcessor,
} from "./processors/pipeline-processors.js"
import {
  createCompileTriggerProcessor,
  createEmbeddingProcessor,
  createPublishGateProcessor,
  createRollbackGateProcessor,
} from "./processors/triggers.js"
import { parseWorkerS3Options } from "./processors/release-pipeline.js"
import type { WorkerLogEvent } from "./processors/types.js"
import { dispatchDuePublicationPlansToQueue } from "./publication-plans-dispatch.js"
import { QUEUE_NAME, workJobOptions } from "./queues/flows.js"
import { reconcileNonTerminalOperations } from "./reconcile/reconcile.js"
import { createWorkerRuntime } from "./runtime/worker-runtime.js"

const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1_000

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
      queue: QUEUE_NAME.generation,
    }),
  )
  const context = { client, logger }
  const publish = createPublishGateProcessor(context)
  const rollback = createRollbackGateProcessor(context)
  const connection = parseWorkerRedisOptions(process.env)
  const queuePrefix = parseQueuePrefix(process.env["GEO_FOUNDRY_WORKER_QUEUE_PREFIX"])
  const intakeQueue = new Queue(QUEUE_NAME.intake, {
    connection,
    defaultJobOptions: workJobOptions(),
    prefix: queuePrefix,
  })
  const snapshots = createSnapshotStore(parseWorkerS3Options(process.env, credential))
  const processors = {
    compile: createCompileTriggerProcessor(context),
    embedding: createEmbeddingProcessor(context, provider),
    evaluation: createEvaluationProcessor(context, provider),
    generation: createGenerationProcessor(context, provider),
    intake: createIntakeProcessor({
      client,
      enqueue: async ({ intakeItemId, tenantId }) => {
        await intakeQueue.add(
          "fetch",
          { intakeItemId, tenantId },
          { ...workJobOptions(), jobId: intakeJobIdOf(intakeItemId) },
        )
      },
      logger,
      snapshots,
    }),
    publish: async (job: Parameters<typeof publish>[0]) =>
      job.name === "rollback-gate" ? rollback(job) : publish(job),
  }
  const runtime = createWorkerRuntime({
    connection,
    context,
    logger,
    outboxProcessor: (queues) =>
      createOutboxProcessor({ embeddingQueue: queues.embedding, logger }),
    processors,
    prefix: queuePrefix,
  })
  const producer = new FlowProducer({ connection, prefix: queuePrefix })
  let reconciling = false
  let dispatchingPublicationPlans = false
  const dispatchPublicationPlans = async () => {
    if (dispatchingPublicationPlans) return
    dispatchingPublicationPlans = true
    try {
      for (const tenantId of tenantKeyring.keys()) {
        await runForTenant(tenantId, async () =>
          dispatchDuePublicationPlansToQueue({
            client,
            logger,
            now: new Date().toISOString(),
            producer,
            workerId: `worker-${process.pid}`,
          }),
        )
      }
    } finally {
      dispatchingPublicationPlans = false
    }
  }
  const reconcile = async () => {
    if (reconciling) {
      return
    }
    reconciling = true
    try {
      for (const tenantId of tenantKeyring.keys()) {
        const report = await runForTenant(tenantId, async () =>
          reconcileNonTerminalOperations(client, producer),
        )
        if (report.enqueued.length > 0 || report.failures.length > 0) {
          logger({
            code: "worker.reconciled",
            detail: { enqueued: report.enqueued.length, failures: report.failures.length, tenantId },
            jobId: null,
            queue: QUEUE_NAME.generation,
          })
        }
      }
    } finally {
      reconciling = false
    }
  }
  await reconcile()
  await dispatchPublicationPlans()
  await runtime.start()
  const reconciliationTimer = setInterval(() => {
    void reconcile()
  }, RECONCILIATION_INTERVAL_MS)
  const publicationPlanTimer = setInterval(() => {
    void dispatchPublicationPlans()
  }, 1_000)
  const shutdown = async () => {
    clearInterval(reconciliationTimer)
    clearInterval(publicationPlanTimer)
    await runtime.close()
    await intakeQueue.close()
    snapshots.close()
    await producer.close()
    process.exit(0)
  }
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
}

if (process.argv[1]?.endsWith("main.js") === true) {
  void main()
}
