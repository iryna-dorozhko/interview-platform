export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[]): Promise<string>;
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
