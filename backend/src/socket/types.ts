export type LiveMessageDto = {
  id: string;
  authorType: "HUMAN_HR" | "HUMAN_CANDIDATE";
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
