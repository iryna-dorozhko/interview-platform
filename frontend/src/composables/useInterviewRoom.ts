import { computed, onMounted, onUnmounted, ref } from "vue";
import { connectSocket } from "../api/socket";

export type LiveAuthorType =
  | "HUMAN_HR"
  | "HUMAN_CANDIDATE"
  | "AGENT_ARBITER"
  | "AGENT_COMPANY"
  | "AGENT_CANDIDATE";

export type AgentThinkingState = {
  active: boolean;
  agentType?: LiveAuthorType;
};

export type ArbiterProcessEntry = {
  at: string;
  action: string;
  summaryUk: string;
};

export type LiveMessage = {
  id: string;
  authorType: LiveAuthorType;
  content: string;
  createdAt: string;
};

export type RoomConnectionState = "connecting" | "connected" | "error";

const ARBITER_PROCESS_LOG_MAX = 8;

export function useInterviewRoom(interviewId: string, currentRole: "HR" | "CANDIDATE") {
  const messages = ref<LiveMessage[]>([]);
  const connectionState = ref<RoomConnectionState>("connecting");
  const errorMessage = ref<string | null>(null);
  const interviewStatus = ref<"AWAITING_CANDIDATE" | "READY" | "LIVE" | "ENDED" | null>(null);
  const agentThinking = ref<AgentThinkingState | null>(null);
  const agentError = ref<string | null>(null);
  const arbiterProcessLog = ref<ArbiterProcessEntry[]>([]);

  const socket = connectSocket();

  function mergeMessages(incoming: LiveMessage[]): void {
    const byId = new Map(messages.value.map((item) => [item.id, item]));
    for (const item of incoming) {
      byId.set(item.id, item);
    }
    messages.value = [...byId.values()].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  function onConnect(): void {
    connectionState.value = "connected";
    errorMessage.value = null;
    socket.emit("room:join", { interviewId });
  }

  function onDisconnect(): void {
    connectionState.value = "connecting";
  }

  function onConnectError(): void {
    connectionState.value = "error";
    errorMessage.value = "Не вдалося підключитися до кімнати";
  }

  function onMessages(payload: { messages?: LiveMessage[] }): void {
    if (Array.isArray(payload?.messages)) {
      mergeMessages(payload.messages);
      if (payload.messages.some((m) => m.authorType.startsWith("AGENT_"))) {
        agentThinking.value = { active: false };
      }
    }
  }

  function onAgentError(payload: { error?: string }): void {
    if (typeof payload?.error === "string" && payload.error.trim()) {
      agentError.value = payload.error.trim();
      agentThinking.value = { active: false };
    }
  }

  function onAgentThinking(payload: { active?: boolean; agentType?: LiveAuthorType }): void {
    if (typeof payload?.active !== "boolean") return;
    agentThinking.value = {
      active: payload.active,
      agentType: payload.agentType,
    };
  }

  function onArbiterProcess(payload: {
    at?: string;
    action?: string;
    summaryUk?: string;
  }): void {
    if (currentRole !== "HR") return;
    if (
      typeof payload?.at !== "string" ||
      typeof payload?.action !== "string" ||
      typeof payload?.summaryUk !== "string" ||
      !payload.summaryUk.trim()
    ) {
      return;
    }
    const entry: ArbiterProcessEntry = {
      at: payload.at,
      action: payload.action,
      summaryUk: payload.summaryUk.trim(),
    };
    arbiterProcessLog.value = [entry, ...arbiterProcessLog.value].slice(0, ARBITER_PROCESS_LOG_MAX);
  }

  function onStatus(payload: { status?: "AWAITING_CANDIDATE" | "READY" | "LIVE" | "ENDED" }): void {
    if (payload?.status) {
      interviewStatus.value = payload.status;
    }
  }

  function onError(payload: { error?: string }): void {
    connectionState.value = "error";
    errorMessage.value = payload?.error ?? "Помилка кімнати";
  }

  function sendMessage(content: string): void {
    const text = content.trim();
    if (!text || connectionState.value !== "connected") return;
    if (interviewStatus.value === "ENDED") return;
    socket.emit("room:message", { interviewId, content: text });
  }

  onMounted(() => {
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:messages", onMessages);
    socket.on("room:status", onStatus);
    socket.on("room:error", onError);
    socket.on("room:agent-thinking", onAgentThinking);
    socket.on("room:agent-error", onAgentError);
    socket.on("room:arbiter-process", onArbiterProcess);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }
  });

  onUnmounted(() => {
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("connect_error", onConnectError);
    socket.off("room:messages", onMessages);
    socket.off("room:status", onStatus);
    socket.off("room:error", onError);
    socket.off("room:agent-thinking", onAgentThinking);
    socket.off("room:agent-error", onAgentError);
    socket.off("room:arbiter-process", onArbiterProcess);
  });

  const isReadOnly = computed(
    () => interviewStatus.value === "ENDED" || connectionState.value === "error",
  );

  return {
    messages,
    connectionState,
    errorMessage,
    interviewStatus,
    agentThinking,
    agentError,
    arbiterProcessLog,
    currentRole,
    sendMessage,
    isReadOnly,
  };
}
