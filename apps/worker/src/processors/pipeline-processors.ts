import { operationJobPayloadIssueText, parseOperationJobPayload } from "@geo/content-client"
import {
  draftDocumentOf,
  runEvaluationOperation,
  runGenerationOperation,
  type LLMProvider,
} from "@geo/content-pipeline"

import { operationProcessor } from "./operation-processor.js"
import { TerminalJobError, type ProcessorContext } from "./types.js"

/** Generation stage: operator brief -> staged pipeline (Todo 23) for every target. */
export const createGenerationProcessor = (context: ProcessorContext, provider: LLMProvider) =>
  operationProcessor(
    { context },
    {
      stage: "generation",
      work: async (ctx, job) => {
        const parsed = parseOperationJobPayload(job.data.payload, "generate")
        if (!parsed.success) {
          throw new TerminalJobError(
            "GENERATION_PAYLOAD_INVALID",
            operationJobPayloadIssueText(parsed.error),
          )
        }
        const operation = await ctx.client.getOperation(job.data.operationId)
        const result = await runGenerationOperation(
          { client: ctx.client, provider },
          {
            attempt: operation.attempt,
            brief: {
              intent: parsed.data.brief.intent,
              sources: parsed.data.brief.sources,
              topic: parsed.data.brief.topic,
              ...(parsed.data.brief.constraints === undefined
                ? {}
                : { constraints: parsed.data.brief.constraints }),
            },
            contentId: parsed.data.contentId,
            operationId: job.data.operationId,
            requestId: `job-${job.id ?? job.data.operationId}`,
            targets: parsed.data.targets.map((target) => ({
              angle: target.angle,
              editionId: target.editionId,
              siteStrategy: {
                locale: target.siteStrategy.locale,
                name: target.siteStrategy.name,
                ...(target.siteStrategy.tone === undefined
                  ? {}
                  : { tone: target.siteStrategy.tone }),
              },
            })),
          },
        )
        return {
          kind: "succeeded" as const,
          result: { generatedEditionIds: result.outcomes.map((outcome) => outcome.editionId) },
        }
      },
    },
  )

/**
 * Evaluation stage: three-layer gate, A3 起按成员站扇出——确定性/LLM 打分
 * 各一次，语义层与阈值判定按站各一次，每站落一条 immutable assessment。
 */
export const createEvaluationProcessor = (context: ProcessorContext, provider: LLMProvider) =>
  operationProcessor(
    { context },
    {
      stage: "evaluation",
      work: async (ctx, job) => {
        const parsed = parseOperationJobPayload(job.data.payload, "evaluate")
        if (!parsed.success) {
          throw new TerminalJobError(
            "EVALUATION_PAYLOAD_INVALID",
            operationJobPayloadIssueText(parsed.error),
          )
        }
        const evaluation = await runEvaluationOperation(
          { client: ctx.client, provider },
          {
            attempt: 1,
            editionId: parsed.data.editionId,
            operationId: job.data.operationId,
            ...(parsed.data.sites === undefined ? {} : { sites: parsed.data.sites }),
            ...(parsed.data.thresholds === undefined ? {} : { thresholds: parsed.data.thresholds }),
          },
          (edition) =>
            draftDocumentOf({
              body: edition.body as unknown[],
              contentId: edition.contentId,
              pathname: `/drafts/${edition.editionId}`,
              siteId: "draft",
              summary: typeof edition.summary === "string" ? edition.summary : "",
              title: typeof edition.title === "string" ? edition.title : "Untitled draft",
            }),
        )
        return {
          kind: "succeeded" as const,
          result: {
            assessmentIds: [...evaluation.assessmentIds],
            perSite: evaluation.perSite.map((site) => ({
              decision: site.aggregate.decision,
              reasons: [...site.aggregate.gate.reasons],
              siteId: site.siteId,
              state: site.aggregate.assessmentState,
            })),
          },
        }
      },
    },
  )
