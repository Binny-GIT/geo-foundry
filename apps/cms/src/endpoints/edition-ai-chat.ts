import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { optionalCmsCredential } from "../config/credentials"

const messageSchema = z
  .object({
    content: z.string().trim().min(1).max(4000),
    role: z.enum(["assistant", "user"]),
  })
  .strict()

const bodySchema = z
  .object({
    messages: z.array(messageSchema).min(1).max(30),
  })
  .strict()

type ChatMessage = z.infer<typeof messageSchema>

const editionIdOf = (req: PayloadRequest): number | null => {
  const value = Number(req.routeParams?.["id"])
  return Number.isInteger(value) && value > 0 ? value : null
}

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

/** Flattens the stored block array into a plain outline the model can read. */
const outlineOf = (value: unknown): string => {
  if (!Array.isArray(value)) return ""
  return value
    .slice(0, 40)
    .map((block) => {
      const row = record(block)
      const type = textOf(row["blockType"])
      const text = textOf(row["text"]).slice(0, 400)
      return type === "heading" ? `## ${text}` : text.length > 0 ? text : `[${type}]`
    })
    .filter((line) => line.length > 0)
    .join("\n\n")
    .slice(0, 8000)
}

type ProviderConfig = Readonly<{
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
}>

/**
 * The chat assistant reuses the platform's single AI provider contract
 * (OpenAI-compatible base URL + chat model + file-backed key). It stays
 * unconfigured — and refuses explicitly — until an operator supplies those
 * values, so no request is ever silently answered by a stub.
 */
const providerConfigOf = (
  environment: Record<string, string | undefined>,
): ProviderConfig | null => {
  if (environment["AI_PROVIDER"] !== "openai-compatible") return null
  const baseUrl = environment["AI_BASE_URL"]?.trim()
  const model = environment["AI_CHAT_MODEL"]?.trim()
  // A missing or wrongly-permissioned key file means "not configured yet",
  // not a server fault: the operator still has to install the credential.
  let apiKey: string | undefined
  try {
    apiKey = optionalCmsCredential(environment, "AI_API_KEY")
  } catch {
    return null
  }
  if (
    baseUrl === undefined ||
    baseUrl.length === 0 ||
    model === undefined ||
    model.length === 0 ||
    apiKey === undefined
  ) {
    return null
  }
  const timeout = Number(environment["AI_TIMEOUT_MS"])
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    timeoutMs: Number.isInteger(timeout) && timeout > 0 && timeout <= 600_000 ? timeout : 60_000,
  }
}

const BASE_PROMPTS = [
  "你是 Geo Foundry 内容工作台的写作助手，为编辑提供中文写作建议。",
  "回答要具体、可直接落到稿件里；需要输出正文时用纯文本段落，不要使用 Markdown 表格或代码块。",
  "只依据用户提供的信息作答，不要编造事实、数据或来源。",
]

/* An unsaved draft has no document yet, so there is nothing to inject; the
 * assistant then works as a plain writing helper until the article exists. */
const systemPromptOf = (edition: Record<string, unknown> | null): string =>
  edition === null
    ? [...BASE_PROMPTS, "", "当前是一篇尚未保存的新稿件，请根据用户的描述起草内容。"].join("\n")
    : [
        ...BASE_PROMPTS,
        "",
        "当前稿件信息：",
        `标题：${textOf(edition["title"]) || "（未填写）"}`,
        `摘要：${textOf(edition["summary"]) || "（未填写）"}`,
        `主要主题：${textOf(edition["primaryTopic"]) || "（未填写）"}`,
        `内容角度：${textOf(edition["angle"]) || "（未填写）"}`,
        "",
        "正文大纲：",
        outlineOf(edition["body"]) || "（正文为空）",
      ].join("\n")

const replyOf = async (
  config: ProviderConfig,
  system: string,
  messages: readonly ChatMessage[],
): Promise<string> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        max_tokens: 2048,
        messages: [{ content: system, role: "system" }, ...messages],
        model: config.model,
        temperature: 0.4,
      }),
      // Next patches the server-side fetch with caching semantics; a
      // credentialed POST through that patch fails as a bare "fetch failed".
      cache: "no-store",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    })
    if (!upstream.ok) throw new Error("AI_CHAT_UPSTREAM_FAILED")
    const payload = (await upstream.json()) as {
      choices?: readonly { message?: { content?: unknown } }[]
    }
    const reply = payload.choices?.[0]?.message?.content
    if (typeof reply !== "string" || reply.trim().length === 0) {
      throw new Error("AI_CHAT_UPSTREAM_EMPTY")
    }
    return reply.trim()
  } finally {
    clearTimeout(timer)
  }
}

const chatHandler = async (req: PayloadRequest, editionId: number | null): Promise<Response> => {
  if (resolveSessionClaims(req.user) === null) {
    return response(401, { error: { code: "AI_CHAT_UNAUTHENTICATED" } })
  }
  let raw: unknown
  try {
    raw = await req.json?.()
  } catch {
    return response(400, { error: { code: "AI_CHAT_BODY_INVALID" } })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return response(400, { error: { code: "AI_CHAT_BODY_INVALID" } })

  let edition: Record<string, unknown> | null = null
  if (editionId !== null) {
    // Access-controlled read: the assistant may only see editions the caller
    // can already open, so the prompt can never widen tenant scope.
    const found = await req.payload.find({
      collection: "content-editions",
      depth: 0,
      draft: true,
      limit: 1,
      overrideAccess: false,
      user: req.user,
      where: { id: { equals: editionId } },
    })
    const doc = found.docs[0]
    if (doc === undefined) return response(404, { error: { code: "AI_CHAT_NOT_FOUND" } })
    edition = record(doc)
  }

  const config = providerConfigOf(process.env)
  if (config === null) return response(503, { error: { code: "AI_CHAT_UNCONFIGURED" } })

  try {
    const reply = await replyOf(config, systemPromptOf(edition), parsed.data.messages)
    return response(200, { reply })
  } catch (error) {
    const cause = (error as { cause?: unknown })?.cause
    req.payload.logger.error({
      cause: cause === undefined ? undefined : String(cause).slice(0, 300),
      editionId,
      err: error instanceof Error ? error.message : "unknown",
      msg: "edition ai chat failed",
    })
    return response(502, { error: { code: "AI_CHAT_UPSTREAM_FAILED" } })
  }
}

export const editionAiChatEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    if (editionId === null) return response(400, { error: { code: "AI_CHAT_ID_INVALID" } })
    return chatHandler(req, editionId)
  },
  method: "post",
  path: "/editions/:id/ai-chat",
}

/* Same assistant for the unsaved-draft editor: no edition context yet. */
export const editionAiChatDraftEndpoint: Endpoint = {
  handler: async (req) => chatHandler(req, null),
  method: "post",
  path: "/editions/ai-chat",
}
