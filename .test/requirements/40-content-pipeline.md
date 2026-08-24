# 40 内容流水线（CPL）

覆盖 `packages/content-pipeline/src/*`。生成/评估/嵌入流水线与 LLM providers。已有自动化：pipelines、evaluation/llm-evaluation、embeddings/semantic-check、providers/fake、providers/openai-compatible。默认用 fake provider + fixtures，保持确定性。

## 草稿与生成流水线

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CPL-P1-001 | P1 | `draftDocumentOf(brief)` | brief→ArticlePage | 结构完整 | NOT_RUN |
| [ ] | CPL-P0-002 | P0 | `runGenerationOperation` outline→draft | 生成 draft、账本记录 | ledger-journaled、gate 通过 | pipelines |
| [ ] | CPL-P1-003 | P1 | `outlineOutputSchema`/`draftOutputSchema` 校验 | 非法输出被拒 | zod 报错 | NOT_RUN |
| [ ] | CPL-P1-004 | P1 | 生成 gate 未过 | 阻断、不落 draft | — | NOT_RUN |

## 评估流水线（三层门）

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CPL-P0-010 | P0 | `evaluateEdition`/`runEvaluationOperation` 通过 | 生成不可变评估 | 三层门（确定性规则+LLM+语义）一致 | pipelines |
| [ ] | CPL-P0-011 | P0 | 任一层未过 | 评估记录失败、阻断 | immutable assessment | NOT_RUN |
| [ ] | CPL-P0-012 | P0 | `runLlmEvaluation`/`toAssessmentRequest`/`toRedactedEvidence` | 评估请求正确、证据脱敏 | 无敏感泄露 | llm-evaluation |
| [ ] | CPL-P0-013 | P0 | `evaluationInputHash`/`llmThresholdsHash` | 确定性 hash | 相同输入同 hash | NOT_RUN |
| [ ] | CPL-P1-014 | P1 | `EVALUATION_MAX_OUTPUT_TOKENS` 上限 | 超限处理 | — | NOT_RUN |

## 语义检查 / 嵌入

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CPL-P0-020 | P0 | `runSemanticCheck` 相似度判定 | 通过/拒绝正确 | 与阈值一致 | semantic-check |
| [ ] | CPL-P0-021 | P0 | `semanticThresholdsHash`/`SEMANTIC_CANDIDATE_LIMIT` | 确定性、候选上限 | — | NOT_RUN |

## Providers

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | CPL-P1-030 | P1 | `createFakeProvider` + `CHAT_FIXTURES` | 固定输出 | prompt-version 常量匹配 | providers/fake |
| [ ] | CPL-P1-031 | P1 | prompt-version 常量（OUTLINE/DRAFT/REVISION/ADAPTATION/EVALUATION/QUALITY/EMBEDDING） | 版本正确引用 | — | NOT_RUN |
| [ ] | CPL-P1-032 | P1 | `createOpenAICompatibleProvider` 请求/响应 | 正确编解码 | — | providers/openai-compatible |
| [ ] | CPL-P1-033 | P1 | provider 错误 `ProviderError`/`ProviderConfigurationError` | 正确抛出+错误码 | `PROVIDER_ERROR_CODE` | NOT_RUN |
| [ ] | CPL-P2-034 | P2 | 事件 sink / embedding+chat 请求-结果类型 | 类型契约一致 | — | NOT_RUN |
