/*
 * express 5.2.1 未随包发布类型声明，仓库 lockfile 里也没有 @types/express
 * （site-b-express 示例是纯 JS，不需要类型）。为避免为交付服务这一个包
 * 新增一整条 @types/express 及其传递依赖的 lockfile 版本解析，这里手写一份
 * 最小 ambient 声明——只覆盖 app.ts 实际用到的表面（工厂函数、Application、
 * 原始 Node 请求/响应对象）。业务代码一律走 Node 原生的
 * writeHead/write/end，不使用 express 的 res.json()/res.status() 等语法糖，
 * 因此这份声明不需要覆盖 express 完整 API。
 */
declare module "express" {
  import type { IncomingMessage, Server, ServerResponse } from "node:http"

  export type Request = IncomingMessage
  export type Response = ServerResponse & { locals: Record<string, unknown> }

  export type RequestHandler = (request: Request, response: Response) => void | Promise<void>

  export interface Application {
    disable(name: string): this
    get(path: string, handler: RequestHandler): this
    use(handler: RequestHandler): this
    listen(port: number, hostname: string): Server
  }

  // biome-ignore lint/style/noDefaultExport: express 是 CJS 默认导出，ambient 声明必须如实建模其形状。
  export default function express(): Application
}
