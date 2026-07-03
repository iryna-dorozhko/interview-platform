export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "empty_response" | "invalid_request"
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export class LlmUnavailableError extends LlmError {
  constructor(message: string) {
    super(message, "unavailable");
    this.name = "LlmUnavailableError";
  }
}

export class LlmEmptyResponseError extends LlmError {
  constructor(message = "empty response from LLM") {
    super(message, "empty_response");
    this.name = "LlmEmptyResponseError";
  }
}
