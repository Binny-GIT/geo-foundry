import {
  createFakeProvider,
  createOpenAICompatibleProvider,
  parseAiProviderEnvironment,
  type LLMProvider,
  type ProviderEventSink,
} from "@geo/content-pipeline"

export type AiProviderMode = "fake" | "openai-compatible"

const modeOf = (value: string | undefined): AiProviderMode => {
  if (value === undefined || value.trim().length === 0 || value === "fake") return "fake"
  if (value === "openai-compatible") return "openai-compatible"
  throw new Error("WORKER_AI_PROVIDER_INVALID")
}

export const createWorkerAiProvider = (
  environment: Record<string, string | undefined>,
  credential: (name: string) => string,
  onEvent?: ProviderEventSink,
): LLMProvider => {
  switch (modeOf(environment["AI_PROVIDER"])) {
    case "fake":
      return createFakeProvider({ onEvent })
    case "openai-compatible": {
      const apiKey = credential("AI_API_KEY")
      if (apiKey === "unset") throw new Error("WORKER_AI_API_KEY_REQUIRED")
      const { AI_PROVIDER: _mode, ...providerEnvironment } = environment
      void _mode
      return createOpenAICompatibleProvider(
        parseAiProviderEnvironment({ ...providerEnvironment, AI_API_KEY: apiKey }),
        { onEvent },
      )
    }
  }
}
