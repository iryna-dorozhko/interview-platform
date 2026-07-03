import { createGeminiProvider } from "./gemini.provider";
import { createOmlxProvider } from "./omlx.provider";
import type { LlmEnvConfig, LlmProvider } from "./types";

type EnvSource = Record<string, string | undefined>;

const ALLOWED_PROVIDERS = ["omlx", "gemini"] as const;

export function readLlmEnvConfig(env: EnvSource = process.env): LlmEnvConfig {
  const providerRaw = (env.LLM_PROVIDER ?? "omlx").toLowerCase();

  if (!ALLOWED_PROVIDERS.includes(providerRaw as (typeof ALLOWED_PROVIDERS)[number])) {
    throw new Error(`LLM_PROVIDER must be one of: ${ALLOWED_PROVIDERS.join(", ")}`);
  }

  return {
    provider: providerRaw as LlmEnvConfig["provider"],
    omlxBaseUrl: env.OMLX_BASE_URL ?? "http://127.0.0.1:8000",
    omlxModel: env.OMLX_MODEL ?? "Qwen2.5-7B-Instruct-4bit",
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? "gemini-2.0-flash",
  };
}

export function createLlmProvider(env: EnvSource = process.env): LlmProvider {
  const config = readLlmEnvConfig(env);

  if (config.provider === "gemini") {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
    }

    return createGeminiProvider({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
    });
  }

  return createOmlxProvider({
    baseUrl: config.omlxBaseUrl,
    model: config.omlxModel,
  });
}
