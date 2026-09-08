import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import {
  type ProviderConfig,
  providerConfigOf,
  systemPromptOf,
} from "../services/edition-ai-chat-model"

const messageSchema = z
  .object({
    content: z.string().trim().min(1).max(4000),
    role: z.enum(["assistant", "user"]),
  })
  .strict()

/* 编辑器未保存内容的上下文快照：只影响提示词，不改变任何访问边界。 */
const draftSchema = z
  .object({
    markdown: z.string().max(24000),
    summary: z.string().max(1000),
    title: z.string().max(300),
  })
  .partial()
  .strict()

const bodySchema = z
  .object({
    draft: draftSchema.optional(),
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

/* Reasoning models answer with a separate thinking channel; it is surfaced
 * to the editor as a collapsible section, never merged into the article text. */
type Completion = Readonly<{ reasoning: string | null; reply: string }>

const attemptOnce = async (
  config: ProviderConfig,
  system: string,
  messages: readonly ChatMessage[],
): Promise<Completion> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        max_tokens: config.maxTokens,
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
      choices?: readonly {
        message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown }
      }[]
    }
    const message = payload.choices?.[0]?.message
    const reply = message?.content
    if (typeof reply !== "string" || reply.trim().length === 0) {
      throw new Error("AI_CHAT_UPSTREAM_EMPTY")
    }
    // Gateways differ: some name it reasoning_content, others reasoning.
    const thinking = message?.reasoning_content ?? message?.reasoning
    const reasoning =
      typeof thinking === "string" && thinking.trim().length > 0 ? thinking.trim() : null
    return { reasoning, reply: reply.trim() }
  } finally {
    clearTimeout(timer)
  }
}

/* The api-hub gateway occasionally fails the TCP connect (undici's default
 * 10s timeout) while a retry a second later succeeds, so network-level
 * failures get two extra attempts. Anything the gateway answered — 4xx/5xx
 * or an empty completion — is terminal and surfaces immediately. */
const isTransient = (error: unknown): boolean =>
  error instanceof TypeError || (error instanceof Error && error.message === "fetch failed")

const replyOf = async (
  config: ProviderConfig,
  system: string,
  messages: readonly ChatMessage[],
): Promise<Completion> => {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1200))
    try {
      return await attemptOnce(config, system, messages)
    } catch (error) {
      lastError = error
      if (!isTransient(error)) throw error
    }
  }
  throw lastError
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
    const completion = await replyOf(
      config,
      systemPromptOf(edition, parsed.data.draft ?? null),
      parsed.data.messages,
    )
    return response(200, {
      ...(completion.reasoning === null ? {} : { reasoning: completion.reasoning }),
      reply: completion.reply,
    })
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
