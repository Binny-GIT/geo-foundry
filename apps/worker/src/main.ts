import { readFileSync, statSync } from "node:fs"

import { ContentServiceClient } from "@geo/content-client"
import { createFakeProvider } from "@geo/content-pipeline"
import { parseQueuePrefix } from "@geo/domain"
import { FlowProducer } from "bullmq"

import { parseWorkerRedisOptions } from "./config/redis.js"
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
import type { WorkerLogEvent } from "./processors/types.js"
import { QUEUE_NAME } from "./queues/flows.js"
import { reconcileNonTerminalOperations } from "./reconcile/reconcile.js"
import { createWorkerRuntime } from "./runtime/worker-runtime.js"

/**
 * Worker daemon entry: consumes the shared-service Redis queues with the
 * fake provider (deterministic, CI-safe). Switching to the OpenAI-compatible
 * provider is an env decision in a later deployment todo; nothing here
 * auto-selects providers after a failed paid submission.
 */
const credentialOf = (name: string): string => {
  const direct = process.env[name]
  if (direct !== undefined && direct.trim().length > 0) {
    return direct.trim()
  }
  const path = process.env[`${name}_FILE`]
  if (path === undefined || path.trim().length === 0) {
    return "unset"
  }
  const ownerId = process.getuid?.()
  const metadata = statSync(path)
  if (ownerId === undefined || (metadata.mode & 0o077) !== 0 || metadata.uid !== ownerId) {
    throw new Error(`WORKER_CREDENTIAL_FILE_INSECURE:${name}_FILE`)
  }
  const credential = readFileSync(path, "utf8").trim()
  if (credential.length === 0) {
    throw new Error(`WORKER_CREDENTIAL_FILE_EMPTY:${name}_FILE`)
  }
  return credential
}

export const main = async (): Promise<void> => {
  const logger = (event: WorkerLogEvent) =>
    console.log(JSON.stringify({ at: new Date().toISOString(), ...event }))
  const client = new ContentServiceClient({
    apiKey: credentialOf("CONTENT_SERVICE_API_KEY"),
    baseUrl: process.env["CMS_BASE_URL"] ?? "http://127.0.0.1:3090",
  })
  const provider = createFakeProvider()
  const context = { client, logger }
  const publish = createPublishGateProcessor(context)
  const rollback = createRollbackGateProcessor(context)
  const processors = {
    compile: createCompileTriggerProcessor(context),
    embedding: createEmbeddingProcessor(context, provider),
    evaluation: createEvaluationProcessor(context, provider),
    generation: createGenerationProcessor(context, provider),
    publish: async (job: Parameters<typeof publish>[0]) =>
      job.name === "rollback-gate" ? rollback(job) : publish(job),
  }
  const connection = parseWorkerRedisOptions(process.env)
  const queuePrefix = parseQueuePrefix(process.env["GEO_FOUNDRY_WORKER_QUEUE_PREFIX"])
  const runtime = createWorkerRuntime({
    connection,
    context,
    logger,
    processors,
    prefix: queuePrefix,
  })

  const outboxQueue = runtime.queues.embedding
  const outboxWorkerProcessor = createOutboxProcessor({ embeddingQueue: outboxQueue, logger })
  void outboxWorkerProcessor
  const producer = new FlowProducer({ connection, prefix: queuePrefix })
  let reconciling = false
  const reconcile = async () => {
    if (reconciling) {
      return
    }
    reconciling = true
    try {
      const report = await reconcileNonTerminalOperations(client, producer)
      logger({
        code: "worker.reconciled",
        detail: { enqueued: report.enqueued.length, failures: report.failures.length },
        jobId: null,
        queue: QUEUE_NAME.generation,
      })
    } finally {
      reconciling = false
    }
  }
  await reconcile()
  await runtime.start()
  const reconciliationTimer = setInterval(() => {
    void reconcile()
  }, 1_000)
  const shutdown = async () => {
    clearInterval(reconciliationTimer)
    await runtime.close()
    await producer.close()
    process.exit(0)
  }
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
}

if (process.argv[1]?.endsWith("main.js") === true) {
  void main()
}
