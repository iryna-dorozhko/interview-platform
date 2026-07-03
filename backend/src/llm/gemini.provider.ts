import { GoogleGenerativeAI } from "@google/generative-ai";
import { LlmEmptyResponseError } from "./errors";
import type { ChatMessage, LlmProvider } from "./types";

type GeminiConfig = {
  apiKey: string;
  model: string;
};

export function createGeminiProvider(config: GeminiConfig): LlmProvider {
  return {
    name: "gemini",

    async complete(messages: ChatMessage[]): Promise<string> {
      if (messages.length === 0) {
        throw new Error("at least one message required");
      }

      const systemInstruction = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n");

      const chatMessages = messages.filter((message) => message.role !== "system");

      if (chatMessages.length === 0) {
        throw new Error("at least one user or assistant message required");
      }

      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage.role !== "user") {
        throw new Error("last message must be from user");
      }

      const genAI = new GoogleGenerativeAI(config.apiKey);
      const model = genAI.getGenerativeModel({
        model: config.model,
        ...(systemInstruction ? { systemInstruction } : {}),
      });

      const history = chatMessages.slice(0, -1).map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage.content);
      const text = result.response.text().trim();

      if (!text) {
        throw new LlmEmptyResponseError();
      }

      return text;
    },
  };
}
