// Markdown code fence з опційним `json` — типова обгортка LLM-відповіді.
export const LLM_JSON_CODE_FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/

// Markdown code fence з довільним language tag.
export const LLM_CODE_FENCE_RE = /^```(?:\w+)?\s*([\s\S]*?)\s*```$/

// Знімає ```json … ``` або ``` … ``` і повертає внутрішній текст.
export function stripLlmJsonCodeFences(text: string): string {
  const match = text.match(LLM_JSON_CODE_FENCE_RE)
  return match ? match[1] : text
}

// Знімає ```lang … ``` (будь-який tag) і повертає внутрішній текст.
export function stripLlmCodeFences(text: string): string {
  const match = text.match(LLM_CODE_FENCE_RE)
  return match ? match[1] : text
}
