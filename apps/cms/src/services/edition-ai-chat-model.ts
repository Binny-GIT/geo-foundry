import { optionalCmsCredential } from "../config/credentials"

/** AI 对话的服务端纯逻辑：provider 解析与提示词构造，供 endpoint 与单测共用。 */

export type ProviderConfig = Readonly<{
  apiKey: string
  baseUrl: string
  maxTokens: number
  model: string
  timeoutMs: number
}>

/**
 * The chat assistant reuses the platform's single AI provider contract
 * (OpenAI-compatible base URL + chat model + file-backed key). It stays
 * unconfigured — and refuses explicitly — until an operator supplies those
 * values, so no request is ever silently answered by a stub.
 */
export const providerConfigOf = (
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
  // 全文提案默认需要远超对话的输出预算；2048 会把长文提案拦腰截断。
  const maxTokens = Number(environment["AI_MAX_TOKENS"])
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    maxTokens:
      Number.isInteger(maxTokens) && maxTokens >= 256 && maxTokens <= 32_768 ? maxTokens : 8192,
    model,
    timeoutMs: Number.isInteger(timeout) && timeout > 0 && timeout <= 600_000 ? timeout : 60_000,
  }
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

/** Flattens the stored block array into a plain outline the model can read. */
export const outlineOf = (value: unknown): string => {
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

/** 编辑器未保存内容的上下文快照（客户端随请求携带，仅供提示词使用）。 */
export type DraftContext = Readonly<{
  markdown?: string | undefined
  summary?: string | undefined
  title?: string | undefined
}>

/* 注入提示词的正文上限：全文比旧版「大纲」更有用，但不能撑爆模型窗口。 */
const BODY_CONTEXT_LIMIT = 12000
const TRUNCATION_NOTE = "\n\n（正文过长，此处已截断；请基于以上内容作答。）"

/**
 * 正文上下文按权威程度取值：未保存的编辑快照 > 已保存的 bodyMarkdown >
 * 旧文档派生 blocks 的大纲兜底。编辑器里看到的永远是第一份。
 */
const bodyContextOf = (
  edition: Record<string, unknown> | null,
  draft: DraftContext | null,
): string => {
  const unsaved = textOf(draft?.markdown)
  if (unsaved.length > 0) return unsaved
  const saved = textOf(edition?.["bodyMarkdown"])
  if (saved.length > 0) return saved
  return edition === null ? "" : outlineOf(edition["body"])
}

export const BASE_PROMPTS = [
  "你是 Geo Foundry 内容工作台的写作助手，为编辑提供中文写作建议。",
  "只依据用户提供的信息作答，不要编造事实、数据或来源。",
  "",
  "当用户要求撰写、改写或重排整篇正文时，按下面的格式回复：",
  "先用一到两句话说明你做了什么，然后把完整正文放进 ```article 围栏里，围栏内使用 Markdown：",
  "标题用 ## 到 ######，正文用普通段落，列表用 - 或 1.，引用用 >，代码用 ``` 围栏。",
  "当用户要求续写或改写选段时，围栏内只包含新增或改写后的部分，不要重复其余正文。",
  "围栏内只写文章本身，不要写解释、前言或结语。",
  "如果用户只是提问或需要建议，正常回答即可，不要输出 ```article 围栏。",
]

export const systemPromptOf = (
  edition: Record<string, unknown> | null,
  draft: DraftContext | null = null,
): string => {
  const body = bodyContextOf(edition, draft)
  const truncated = body.length > BODY_CONTEXT_LIMIT
  const bodyText = truncated ? body.slice(0, BODY_CONTEXT_LIMIT) + TRUNCATION_NOTE : body
  const title = textOf(draft?.title) || textOf(edition?.["title"])
  const summary = textOf(draft?.summary) || textOf(edition?.["summary"])

  if (edition === null) {
    return [
      ...BASE_PROMPTS,
      "",
      "当前是一篇尚未保存的新稿件，请根据用户的描述与已有内容起草。",
      `标题：${title || "（未填写）"}`,
      `摘要：${summary || "（未填写）"}`,
      "已有正文（可能包含未保存的修改）：",
      bodyText.length > 0 ? bodyText : "（正文为空）",
    ].join("\n")
  }
  return [
    ...BASE_PROMPTS,
    "",
    "当前稿件信息（标题与摘要可能包含未保存的修改）：",
    `标题：${title || "（未填写）"}`,
    `摘要：${summary || "（未填写）"}`,
    `主要主题：${textOf(edition["primaryTopic"]) || "（未填写）"}`,
    `内容角度：${textOf(edition["angle"]) || "（未填写）"}`,
    "",
    "当前正文（Markdown，可能包含未保存的修改）：",
    bodyText.length > 0 ? bodyText : "（正文为空）",
  ].join("\n")
}
