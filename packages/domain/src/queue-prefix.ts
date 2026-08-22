const faultRunIdPattern = /^todo39-[a-z0-9]{20}$/

export const DEFAULT_QUEUE_PREFIX = "geo-foundry"

export class QueuePrefixError extends Error {
  override readonly name = "QueuePrefixError"

  constructor() {
    super("QUEUE_PREFIX_INVALID")
  }
}

export const faultQueuePrefixOf = (runId: string): string => {
  if (!faultRunIdPattern.test(runId)) {
    throw new QueuePrefixError()
  }
  return `${DEFAULT_QUEUE_PREFIX}:${runId}`
}

export const parseQueuePrefix = (value: string | undefined): string => {
  if (value === undefined || value.length === 0) {
    return DEFAULT_QUEUE_PREFIX
  }
  if (value === DEFAULT_QUEUE_PREFIX) {
    return value
  }
  if (!value.startsWith(`${DEFAULT_QUEUE_PREFIX}:`)) {
    throw new QueuePrefixError()
  }
  return faultQueuePrefixOf(value.slice(`${DEFAULT_QUEUE_PREFIX}:`.length))
}
