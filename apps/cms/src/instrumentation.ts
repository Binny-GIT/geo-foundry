import { getPayload } from "payload"

import config from "./payload.config"
import { createOutboxQueue, dispatchPendingOutbox, parseOutboxRedisOptions } from "./outbox/dispatcher"
import { pollDueRssConnectors } from "./services/connector-polling"

const OUTBOX_INTERVAL_MS = 1_000
const RSS_POLL_TIMER_MS = 60_000
const RUNTIME = Symbol.for("geo-foundry.cms.background-runtime")

type BackgroundRuntime = {
  readonly timers: readonly ReturnType<typeof setInterval>[]
}

type GlobalWithRuntime = typeof globalThis & { [RUNTIME]?: BackgroundRuntime }

const emit = (code: string, detail: Record<string, unknown>) =>
  console.error(JSON.stringify({ code, detail }))

export const register = async (): Promise<void> => {
  if (
    process.env["NEXT_RUNTIME"] !== "nodejs" ||
    process.env["GEO_FOUNDRY_CMS_DISABLE_BACKGROUND_RUNTIME"] === "true"
  ) {
    return
  }
  const globalRuntime = globalThis as GlobalWithRuntime
  if (globalRuntime[RUNTIME] !== undefined) return

  const payload = await getPayload({ config })

  let drainingOutbox = false
  const queue = createOutboxQueue(parseOutboxRedisOptions(process.env))
  const dispatchOutbox = async (): Promise<void> => {
    if (drainingOutbox) return
    drainingOutbox = true
    try {
      const result = await dispatchPendingOutbox(payload, queue)
      if (result.failed > 0) {
        emit("cms.outbox.dispatch-failed", { examined: result.examined, failed: result.failed })
      }
    } catch (error) {
      emit("cms.outbox.dispatch-error", {
        message: String(error instanceof Error ? error.message : error).slice(0, 200),
      })
    } finally {
      drainingOutbox = false
    }
  }

  let pollingRss = false
  const pollRss = async (): Promise<void> => {
    if (pollingRss) return
    pollingRss = true
    try {
      const report = await pollDueRssConnectors(payload)
      if (report.polled.length > 0) {
        emit("cms.rss.polled", { connectors: report.polled.length })
      }
      for (const skip of report.skipped) {
        emit("cms.rss.skipped", skip)
      }
      for (const failure of report.errors) {
        emit("cms.rss.error", failure)
      }
    } catch (error) {
      emit("cms.rss.poll-error", {
        message: String(error instanceof Error ? error.message : error).slice(0, 200),
      })
    } finally {
      pollingRss = false
    }
  }

  const timers = [
    setInterval(() => void dispatchOutbox(), OUTBOX_INTERVAL_MS),
    setInterval(() => void pollRss(), RSS_POLL_TIMER_MS),
  ]
  globalRuntime[RUNTIME] = { timers }
  await dispatchOutbox()
  await pollRss()
}
