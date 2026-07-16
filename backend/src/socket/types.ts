export type LiveAuthorTypeDto =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

export type LiveMessageDto = {
  id: string;
  authorType: LiveAuthorTypeDto;
  content: string;
  createdAt: string;
};

export type RoomJoinPayload = {
  interviewId?: unknown;
};

export type RoomMessagePayload = {
  interviewId?: unknown;
  content?: unknown;
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
