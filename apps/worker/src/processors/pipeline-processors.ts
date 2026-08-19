import { evaluateRequestSchema, generateRequestSchema } from "@geo/content-client"
import {
  draftDocumentOf,
  runEvaluationOperation,
  runGenerationOperation,
  type LLMProvider,
} from "@geo/content-pipeline"

import type { Job } from "bullmq"
import { operationProcessor } from "./operation-processor.js"
import { TerminalJobError, type ProcessorContext, type WorkJobData } from "./types.js"

const bodyOf = (job: Job<WorkJobData>): Record<string, unknown> => {
  const payload = job.data.payload ?? {}
  return typeof payload["body"] === "object" && payload["body"] !== null
    ? (payload["body"] as Record<string, unknown>)
    : {}
}

const issueTextOf = (
  issues: readonly { message: string; path: (number | string | symbol)[] }[],
): string =>
  issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ")

/** Generation stage: operator brief -> staged pipeline (Todo 23) for every target. */
export const createGenerationProcessor = (context: ProcessorContext, provider: LLMProvider) =>
  operationProcessor(
    { context },
    {
      stage: "generation",
      work: async (ctx, job) => {
        const parsed = generateRequestSchema.safeParse(bodyOf(job))
        if (!parsed.success) {
          throw new TerminalJobError("GENERATION_PAYLOAD_INVALID", issueTextOf(parsed.error.issues))
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
          result: {
            outcomes: result.outcomes.map((outcome) => ({
              decision: outcome.decision,
              editionId: outcome.editionId,
              revised: outcome.revised,
            })),
          },
        }
      },
    },
  )

/** Evaluation stage: three-layer gate persisted as one immutable assessment. */
export const createEvaluationProcessor = (context: ProcessorContext, provider: LLMProvider) =>
  operationProcessor(
    { context },
    {
      stage: "evaluation",
      work: async (ctx, job) => {
        const parsed = evaluateRequestSchema.safeParse(bodyOf(job))
        if (!parsed.success) {
          throw new TerminalJobError("EVALUATION_PAYLOAD_INVALID", issueTextOf(parsed.error.issues))
        }
        const evaluation = await runEvaluationOperation(
          { client: ctx.client, provider },
          {
            attempt: 1,
            editionId: parsed.data.editionId,
            operationId: job.data.operationId,
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
            assessmentId: evaluation.assessmentId,
            decision: evaluation.aggregate.decision,
            reasons: [...evaluation.aggregate.gate.reasons],
          },
        }
      },
    },
  )
