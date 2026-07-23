export type LiveAuthorTypeDto =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

export type CandidateConfidenceDto = "CONFIRMED" | "INFERRED" | "UNKNOWN";

export type LiveMessageDto = {
  id: string;
  authorType: LiveAuthorTypeDto;
  content: string;
  candidateConfidence?: CandidateConfidenceDto | null;
  createdAt: string;
};

export type RoomJoinPayload = {
  interviewId?: unknown;
};

export type RoomMessagePayload = {
  interviewId?: unknown;
  content?: unknown;
};

export type RoomAgentRetryPayload = {
  interviewId?: unknown;
};

export type RoomTypingPayload = {
  interviewId?: unknown;
  isTyping?: unknown;
};

export type RoomTypingEvent = {
  role: "HR" | "CANDIDATE";
  isTyping: boolean;
};

export type RoomMessagesEvent = {
  messages: LiveMessageDto[];
};

export type RoomStatusEvent = {
  status: "LIVE" | "ENDED";
};

export type RoomErrorEvent = {
  error: string;
};

export type RoomAgentThinkingEvent = {
  active: boolean;
  agentType?: "AGENT_ARBITER" | "AGENT_COMPANY" | "AGENT_CANDIDATE";
};

export type RoomAgentErrorEvent = {
  agentType?: "AGENT_ARBITER" | "AGENT_COMPANY" | "AGENT_CANDIDATE";
  error: string;
};

export type RoomArbiterProcessEvent = {
  at: string;
  action: string;
  summaryUk: string;
};

export type DialogJoinPayload = { dialogId?: unknown };
export type DialogTypingPayload = { dialogId?: unknown; isTyping?: unknown };

export type DialogTypingEvent = {
  role: "HR" | "CANDIDATE";
  isTyping: boolean;
};

export type DialogMessageDto = {
  id: string;
  dialogId: string;
  senderUserId: string;
  body: string;
  kind: "USER" | "DECISION_LETTER";
  createdAt: string;
  decision?: { type: "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING" } | null;
};

export type DialogErrorEvent = { error: string };
