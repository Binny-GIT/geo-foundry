export type LocalizedLabel = Readonly<{
  en: string
  zh: string
}>

/**
 * Payload 3.88 accepts static locale maps for schema labels and descriptions.
 * Keep schema copy in one small, typed helper so collection configs remain
 * readable and both supported admin languages always receive a value.
 */
export const localized = (en: string, zh: string): LocalizedLabel => ({ en, zh })

export const localizedOption = (value: string, en: string, zh: string) => ({
  label: localized(en, zh),
  value,
})

const fieldLabels: Readonly<Record<string, LocalizedLabel>> = {
  aggregateId: localized("Aggregate ID", "聚合 ID"),
  aggregateType: localized("Aggregate type", "聚合类型"),
  actorUserId: localized("Actor user ID", "操作用户 ID"),
  alt: localized("Alternative text", "替代文本"),
  answer: localized("Answer", "回答"),
  attribution: localized("Attribution", "署名"),
  angle: localized("Content angle", "内容角度"),
  approvedBy: localized("Approved by", "批准人"),
  audit: localized("Audit record", "审计记录"),
  attempt: localized("Attempt", "尝试次数"),
  attempts: localized("Attempts", "尝试次数"),
  auditLog: localized("Audit log", "审计日志"),
  body: localized("Body", "正文"),
  canonicalUrl: localized("Canonical URL", "规范 URL"),
  caption: localized("Caption", "说明文字"),
  cells: localized("Cells", "单元格"),
  citationId: localized("Citation ID", "引文 ID"),
  citeUrl: localized("Citation URL", "引文 URL"),
  code: localized("Code", "代码"),
  columns: localized("Columns", "列"),
  citations: localized("Citations", "引文"),
  compiledRelease: localized("Compiled release", "已编译发布版本"),
  consumedAt: localized("Consumed at", "消费时间"),
  content: localized("Content", "内容"),
  contentModifiedAt: localized("Content modified at", "内容修改时间"),
  creationOrigin: localized("Creation origin", "创建来源"),
  createdBy: localized("Created by", "创建来源"),
  currentStage: localized("Current stage", "当前阶段"),
  dimensions: localized("Dimensions", "维度得分"),
  dispatchedAt: localized("Dispatched at", "分发时间"),
  email: localized("Email", "电子邮箱"),
  extensions: localized("Extensions", "扩展"),
  endpoint: localized("Endpoint", "端点"),
  entities: localized("Entities", "实体"),
  error: localized("Error", "错误"),
  eventId: localized("Event ID", "事件 ID"),
  eventPayload: localized("Event payload", "事件负载"),
  edition: localized("Content edition", "内容版本"),
  expectedCurrentManifestSha256: localized(
    "Expected current manifest SHA-256",
    "预期当前清单 SHA-256",
  ),
  expectedCurrentReleaseId: localized("Expected current release ID", "预期当前发布版本 ID"),
  expectedManifestSha256: localized("Expected manifest SHA-256", "预期清单 SHA-256"),
  filesize: localized("File size", "文件大小"),
  filename: localized("Filename", "文件名"),
  height: localized("Height", "高度"),
  fromManifestSha256: localized("Source manifest SHA-256", "来源清单 SHA-256"),
  fromReleaseId: localized("Source release ID", "来源发布版本 ID"),
  idempotencyKey: localized("Idempotency key", "幂等键"),
  idempotencyKeyHash: localized("Idempotency key hash", "幂等键哈希"),
  inputHash: localized("Input hash", "输入哈希"),
  intent: localized("Intent", "意图"),
  language: localized("Language", "语言"),
  items: localized("Items", "条目"),
  intentId: localized("Intent ID", "意图 ID"),
  issues: localized("Issues", "问题"),
  lastError: localized("Last error", "最近错误"),
  lastStageAt: localized("Last stage at", "最近阶段时间"),
  level: localized("Heading level", "标题级别"),
  locale: localized("Locale", "区域设置"),
  manifestSha256: localized("Manifest SHA-256", "清单 SHA-256"),
  mediaPath: localized("Media path", "媒体路径"),
  mimeType: localized("MIME type", "MIME 类型"),
  modelId: localized("Model ID", "模型 ID"),
  name: localized("Name", "名称"),
  operationId: localized("Operation ID", "操作 ID"),
  operationType: localized("Operation type", "操作类型"),
  overall: localized("Overall score", "总体得分"),
  pathname: localized("Pathname", "路径名"),
  poster: localized("Poster", "封面图"),
  prefix: localized("Storage prefix", "存储前缀"),
  provider: localized("Provider", "提供方"),
  promptVersion: localized("Prompt version", "提示词版本"),
  primaryTopic: localized("Primary topic", "主要主题"),
  providerVersion: localized("Provider version", "提供方版本"),
  question: localized("Question", "问题"),
  reason: localized("Reason", "原因"),
  receipt: localized("Receipt", "回执"),
  releaseId: localized("Release ID", "发布版本 ID"),
  replayCount: localized("Replay count", "重放次数"),
  requestHash: localized("Request hash", "请求哈希"),
  requestId: localized("Request ID", "请求 ID"),
  requestPayload: localized("Request payload", "请求负载"),
  result: localized("Result", "结果"),
  responsePayload: localized("Response payload", "响应负载"),
  revision: localized("Revision", "修订版本"),
  role: localized("Role", "角色"),
  rows: localized("Rows", "行"),
  runtimeSiteId: localized("Runtime site ID", "运行时站点 ID"),
  secondaryTopics: localized("Secondary topics", "次要主题"),
  src: localized("Source URL", "来源 URL"),
  style: localized("List style", "列表样式"),
  site: localized("Site", "站点"),
  state: localized("State", "状态"),
  status: localized("Status", "状态"),
  statusCode: localized("Status code", "状态码"),
  summary: localized("Summary", "摘要"),
  targetIds: localized("Target IDs", "目标 ID"),
  targetReleaseId: localized("Target release ID", "目标发布版本 ID"),
  targetUrl: localized("Target URL", "目标 URL"),
  text: localized("Text", "文本"),
  tenant: localized("Tenant", "租户"),
  tone: localized("Tone", "语调"),
  transcript: localized("Transcript", "文稿"),
  thresholdsHash: localized("Thresholds hash", "阈值哈希"),
  title: localized("Title", "标题"),
  topic: localized("Topic", "主题"),
  type: localized("Type", "类型"),
  uniqueKey: localized("Unique key", "唯一键"),
  url: localized("URL", "URL"),
  workflowActions: localized("Workflow actions", "工作流操作"),
  workflowRevision: localized("Workflow revision", "工作流修订版本"),
  versionId: localized("Version ID", "版本 ID"),
  width: localized("Width", "宽度"),
  workflowStatus: localized("Workflow status", "工作流状态"),
}

const optionLabels: Readonly<Record<string, LocalizedLabel>> = {
  active: localized("Active", "启用"),
  archived: localized("Archived", "已归档"),
  ai: localized("AI", "AI"),
  alias: localized("Alias", "别名"),
  approved: localized("Approved", "已批准"),
  building: localized("Building", "构建中"),
  cancelled: localized("Cancelled", "已取消"),
  canonical: localized("Canonical", "规范域名"),
  "content-service": localized("Content service", "内容服务"),
  compiled: localized("Compiled", "已编译"),
  current: localized("Current", "当前"),
  disabled: localized("Disabled", "停用"),
  dispatched: localized("Dispatched", "已分发"),
  edition: localized("Edition", "内容版本"),
  editor: localized("Editor", "编辑"),
  draft: localized("Draft", "草稿"),
  error: localized("Error", "错误"),
  evaluate: localized("Evaluate", "评估"),
  failed: localized("Failed", "失败"),
  generating: localized("Generating", "生成中"),
  generate: localized("Generate", "生成"),
  gone: localized("Gone", "已移除"),
  human: localized("Human", "人工"),
  hybrid: localized("Hybrid", "混合"),
  passed: localized("Passed", "通过"),
  pending: localized("Pending", "待处理"),
  publisher: localized("Publisher", "发布者"),
  publish: localized("Publish", "发布"),
  published: localized("Published", "已发布"),
  queued: localized("Queued", "排队中"),
  redirected: localized("Redirected", "已重定向"),
  reserved: localized("Reserved", "已保留"),
  reviewer: localized("Reviewer", "审核者"),
  review: localized("In review", "审核中"),
  rollback: localized("Rollback", "回滚"),
  rolled_back: localized("Rolled back", "已回滚"),
  running: localized("Running", "运行中"),
  succeeded: localized("Succeeded", "成功"),
  "super-admin": localized("Super administrator", "超级管理员"),
  superseded: localized("Superseded", "已替代"),
  "tenant-admin": localized("Tenant administrator", "租户管理员"),
  uploaded: localized("Uploaded", "已上传"),
  validated: localized("Validated", "已验证"),
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Add localized labels to otherwise schema-identical Payload field definitions. */
export const localizedFields = <T>(fields: T): T => {
  if (!Array.isArray(fields)) {
    return fields
  }
  return fields.map((entry) => {
    if (!isRecord(entry)) {
      return entry
    }
    const name = entry["name"]
    const options = entry["options"]
    return {
      ...entry,
      ...(typeof name === "string" &&
      entry["label"] === undefined &&
      fieldLabels[name] !== undefined
        ? { label: fieldLabels[name] }
        : {}),
      ...(Array.isArray(options)
        ? {
            options: options.map((option) =>
              typeof option === "string" && optionLabels[option] !== undefined
                ? localizedOption(option, optionLabels[option].en, optionLabels[option].zh)
                : option,
            ),
          }
        : {}),
      ...(entry["fields"] !== undefined ? { fields: localizedFields(entry["fields"]) } : {}),
    }
  }) as T
}

export type RequestLanguageSource = Readonly<{
  i18n?: Readonly<{ language?: unknown }>
}>

export const requestLanguage = (req: RequestLanguageSource | undefined): "en" | "zh" =>
  req?.i18n?.language === "en" ? "en" : "zh"

export const localizedValidationMessage = (
  req: RequestLanguageSource | undefined,
  en: string,
  zh: string,
): string => localized(en, zh)[requestLanguage(req)]
