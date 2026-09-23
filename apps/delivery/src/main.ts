/*
 * 交付服务进程入口。对应 B2 部署形态：`node /delivery/dist/main.js`，
 * 监听 127.0.0.1:3091（生产环境变量覆盖）。启动即装配环境变量、只读 S3
 * reader、站点密钥 keyring，三者任一缺失/非法都应在启动时立刻失败退出
 * （fail fast），不要带着不完整的配置把进程跑起来。
 */
import { createDeliveryApp } from "./app.js"
import { parseDeliveryEnvironment } from "./config/environment.js"
import { loadSiteKeyringFile } from "./config/site-keyring.js"
import { createDeliveryRuntime } from "./runtime/delivery-runtime.js"
import { createDeliveryObjectReader } from "./store/object-reader.js"

export const main = (): void => {
  const environment = parseDeliveryEnvironment(process.env)
  const siteKeyring = loadSiteKeyringFile(environment.siteKeyringFile)
  const reader = createDeliveryObjectReader(environment.s3)
  const runtime = createDeliveryRuntime({ store: reader })
  const app = createDeliveryApp({
    runtime,
    siteKeyring,
    ...(environment.publicOrigin === null ? {} : { publicOrigin: environment.publicOrigin }),
  })

  const server = app.listen(environment.port, environment.hostname)

  const shutdown = (): void => {
    server.close(() => {
      reader.destroy()
      process.exit(0)
    })
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

if (process.argv[1]?.endsWith("main.js") === true) {
  main()
}
