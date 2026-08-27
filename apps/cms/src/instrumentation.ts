import { getPayload } from "payload"

import config from "./payload.config"
import { createOutboxQueue, dispatchPendingOutbox, parseOutboxRedisOptions } from "./outbox/dispatcher"

const OUTBOX_INTERVAL_MS = 1_000
const OUTBOX_RUNTIME = Symbol.for("geo-foundry.cms.outbox-runtime")

type OutboxRuntime = {
  draining: boolean
  queue: ReturnType<typeof createOutboxQueue>
  timer: ReturnType<typeof setInterval>
}

type GlobalWithOutboxRuntime = typeof globalThis & {
  [OUTBOX_RUNTIME]?: OutboxRuntime
}

export const register = async (): Promise<void> => {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return
  const globalRuntime = globalThis as GlobalWithOutboxRuntime
  if (globalRuntime[OUTBOX_RUNTIME] !== undefined) return

  const payload = await getPayload({ config })
  const queue = createOutboxQueue(parseOutboxRedisOptions(process.env))
  const runtime: OutboxRuntime = {
    draining: false,
    queue,
    timer: undefined as never,
  }
  const dispatch = async (): Promise<void> => {
    if (runtime.draining) return
    runtime.draining = true
    try {
      const result = await dispatchPendingOutbox(payload, queue)
      if (result.failed > 0) {
        console.error(
          JSON.stringify({
            code: "cms.outbox.dispatch-failed",
            detail: { examined: result.examined, failed: result.failed },
          }),
        )
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          code: "cms.outbox.dispatch-error",
          detail: { message: String(error instanceof Error ? error.message : error).slice(0, 200) },
        }),
      )
    } finally {
      runtime.draining = false
    }
  }
  runtime.timer = setInterval(() => void dispatch(), OUTBOX_INTERVAL_MS)
  globalRuntime[OUTBOX_RUNTIME] = runtime
  await dispatch()
}
