/*
 * 服务端结构化日志（pino）。
 *
 * 输出 JSON 到 stdout；级别由 LOG_LEVEL 控制（默认 info）。
 * 路由层用 child({ requestId, route }) 绑定请求上下文，
 * 500 级错误必须带 stack 落日志，方便线上排查。
 */

import pino from "pino"

const isProduction = process.env.NODE_ENV === "production"

export const logger = pino({
  base: { service: "cms" },
  level: process.env["LOG_LEVEL"] ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
      "*.apiKey",
      "*.password",
      "*.token",
    ],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export const loggerOf = (bindings: Record<string, unknown>) => logger.child(bindings)
