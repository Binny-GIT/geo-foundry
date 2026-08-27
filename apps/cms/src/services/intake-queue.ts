import { intakeJobIdOf, parseQueuePrefix } from "@geo/domain"
import { Queue } from "bullmq"

import { optionalCmsCredential } from "../config/credentials"

export const INTAKE_QUEUE_NAME = "content-intake"

export type IntakeQueueJob = Readonly<{
  intakeItemId: number
  tenantId: number
}>

export type IntakeQueueOptions = Readonly<{
  db: number
  host: string
  password?: string
  port: number
  username?: string
}>

export const parseIntakeQueueOptions = (
  environment: Record<string, string | undefined>,
): IntakeQueueOptions => {
  const password = optionalCmsCredential(environment, "GEO_FOUNDRY_REDIS_PASSWORD")
  const username = optionalCmsCredential(environment, "GEO_FOUNDRY_REDIS_USERNAME")
  return {
    db: Number(environment["GEO_FOUNDRY_REDIS_DATABASE"] ?? "0") || 0,
    host: environment["GEO_FOUNDRY_REDIS_HOST"] ?? "127.0.0.1",
    ...(password === undefined ? {} : { password }),
    port: Number(environment["GEO_FOUNDRY_REDIS_PORT"] ?? "6379") || 6379,
    ...(username === undefined ? {} : { username }),
  }
}

export const createIntakeQueue = (
  options: IntakeQueueOptions,
  prefix = parseQueuePrefix(process.env["GEO_FOUNDRY_WORKER_QUEUE_PREFIX"]),
): Queue<IntakeQueueJob> =>
  new Queue<IntakeQueueJob>(INTAKE_QUEUE_NAME, { connection: options, prefix })

const intakeJobOptions = {
  attempts: 3,
  backoff: { delay: 2000, type: "exponential" as const },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 86_400 },
}

/**
 * De-duplicates active work and replaces a terminal job before an explicit
 * retry. The job identity stays stable for the intake item's whole lifetime.
 */
export const enqueueIntakeFetch = async (
  queue: Pick<Queue<IntakeQueueJob>, "add" | "getJob">,
  job: IntakeQueueJob,
): Promise<string> => {
  const jobId = intakeJobIdOf(job.intakeItemId)
  const existing = await queue.getJob(jobId)
  if (existing !== null && existing !== undefined) {
    const state = await existing.getState()
    if (state === "active" || state === "delayed" || state === "prioritized" || state === "waiting") {
      return jobId
    }
    await existing.remove()
  }
  await queue.add("fetch", job, { ...intakeJobOptions, jobId })
  return jobId
}

export const enqueueIntakeFetchFromEnvironment = async (job: IntakeQueueJob): Promise<string> => {
  const queue = createIntakeQueue(parseIntakeQueueOptions(process.env))
  try {
    return await enqueueIntakeFetch(queue, job)
  } finally {
    await queue.close()
  }
}
