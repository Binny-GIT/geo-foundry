import { optionalCmsCredential } from "../config/credentials"

/** AI 对话的服务端纯逻辑：provider 解析与提示词构造，供 endpoint 与单测共用。 */

export type ProviderConfig = Readonly<{
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
  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
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

export const BASE_PROMPTS = [
  "你是 Geo Foundry 内容工作台的写作助手，为编辑提供中文写作建议。",
  "只依据用户提供的信息作答，不要编造事实、数据或来源。",
  "",
  "当用户要求撰写、续写、改写或重排正文时，按下面的格式回复：",
  "先用一到两句话说明你做了什么，然后把完整正文放进 ```article 围栏里，围栏内使用 Markdown：",
  "标题用 ## 到 ######，正文用普通段落，列表用 - 或 1.，引用用 >，代码用 ``` 围栏。",
  "围栏内只写文章本身，不要写解释、前言或结语。",
  "如果用户只是提问或需要建议，正常回答即可，不要输出 ```article 围栏。",
]

/* An unsaved draft has no document yet, so there is nothing to inject; the
 * assistant then works as a plain writing helper until the article exists. */
export const systemPromptOf = (edition: Record<string, unknown> | null): string =>
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
