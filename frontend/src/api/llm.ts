import { fetchWithAuth } from "./client";

export type ChatRole = "user" | "assistant";

export type UiMessage = {
  role: ChatRole;
  content: string;
};

export type LlmCompleteResponse = {
  text: string;
  provider: string;
};

type LlmErrorBody = {
  error?: string;
  detail?: string;
};

export async function sendChat(messages: UiMessage[]): Promise<LlmCompleteResponse> {
  const response = await fetchWithAuth("/api/llm/complete", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    let body: LlmErrorBody = {};
    try {
      body = (await response.json()) as LlmErrorBody;
    } catch {
      // ignore parse errors
    }

    if (response.status === 503) {
      throw new Error("Модель недоступна. Запусти `omlx serve`.");
    }

    const detail = body.detail ?? body.error;
    throw new Error(detail ? `Не вдалося отримати відповідь: ${detail}` : "Не вдалося отримати відповідь.");
  }

  return response.json() as Promise<LlmCompleteResponse>;
}
