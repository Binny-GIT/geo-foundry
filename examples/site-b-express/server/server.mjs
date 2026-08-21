import { createRuntime } from "@geo/runtime"

import { createSiteBApp } from "./app.mjs"
import { siteBEnvironmentOf } from "./environment.mjs"
import { createSiteBObjectReader } from "./s3-reader.mjs"

const environment = siteBEnvironmentOf()
const reader = createSiteBObjectReader(environment)
const runtime = createRuntime({ store: reader })
const app = createSiteBApp({ runtime })

const port = Number(process.env.PORT ?? "3102")
const hostname = process.env.HOSTNAME ?? "127.0.0.1"
const server = app.listen(port, hostname)

const shutdown = () => server.close(() => {
  reader.destroy()
  process.exit(0)
})
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
