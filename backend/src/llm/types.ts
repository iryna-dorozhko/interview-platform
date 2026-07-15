export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmCompleteOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string>;
  close?(): Promise<void>;
}

export interface LlmEnvConfig {
  provider: "omlx" | "gemini" | "openai";
  omlxBaseUrl: string;
  omlxModel: string;
  omlxApiKey?: string;
  geminiApiKey?: string;
  geminiModel: string;
  openaiApiKey?: string;
  openaiModel: string;
  openaiBaseUrl: string;
}
