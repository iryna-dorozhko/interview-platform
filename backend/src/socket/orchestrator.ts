import type { Server } from "socket.io";
import type { LiveAuthorType, LiveMessage, PrismaClient } from "@prisma/client";
import type { ParsedPostReply } from "../agents/agent-post-reply";
import { runArbiterTurn as defaultRunArbiterTurn } from "../agents/arbiter-agent";
import { runCompanyLiveTurn as defaultRunCompanyLiveTurn } from "../agents/company-live-agent";
import { runCandidateLiveTurn as defaultRunCandidateLiveTurn } from "../agents/candidate-live-agent";
import type { LlmProvider } from "../llm/types";
import type { LiveMessageDto, RoomAgentThinkingEvent } from "./types";

export const AGENT_DEBOUNCE_MS = 2500;

type RoomState = {
  debounceTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
};

export type RunArbiterTurnFn = (
  interviewId: string,
  sessionId: string,
) => Promise<ParsedPostReply>;

export type RunCompanyLiveTurnFn = RunArbiterTurnFn;
export type RunCandidateLiveTurnFn = RunArbiterTurnFn;

export type RoomOrchestratorOptions = {
  debounceMs?: number;
  runArbiterTurn?: RunArbiterTurnFn;
  runCompanyLiveTurn?: RunCompanyLiveTurnFn;
  runCandidateLiveTurn?: RunCandidateLiveTurnFn;
  getLlmProvider?: () => LlmProvider;
};

export interface RoomOrchestrator {
  onHumanMessage(io: Server, interviewId: string, sessionId: string): void;
}

type AgentStep = {
  agentType: LiveAuthorType;
  run: () => Promise<ParsedPostReply>;
};

const silentTurn: RunArbiterTurnFn = async () => ({ post: false });

function roomName(interviewId: string): string {
  return `interview:${interviewId}`;
}

function toDto(message: LiveMessage): LiveMessageDto {
  return {
    id: message.id,
    authorType: message.authorType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

function emitThinking(io: Server, interviewId: string, payload: RoomAgentThinkingEvent): void {
  io.to(roomName(interviewId)).emit("room:agent-thinking", payload);
}

export function createRoomOrchestrator(
  getPrisma: () => PrismaClient,
  options: RoomOrchestratorOptions = {},
): RoomOrchestrator {
  const debounceMs = options.debounceMs ?? AGENT_DEBOUNCE_MS;

  let runArbiter: RunArbiterTurnFn;
  if (options.runArbiterTurn) {
    runArbiter = options.runArbiterTurn;
  } else if (options.getLlmProvider) {
    const getLlmProvider = options.getLlmProvider;
    runArbiter = (interviewId: string, sessionId: string) =>
      defaultRunArbiterTurn(getPrisma(), interviewId, sessionId, getLlmProvider());
  } else {
    throw new Error("RoomOrchestrator requires runArbiterTurn or getLlmProvider");
  }

  let runCompany: RunCompanyLiveTurnFn;
  if (options.runCompanyLiveTurn) {
    runCompany = options.runCompanyLiveTurn;
  } else if (options.getLlmProvider) {
    const getLlmProvider = options.getLlmProvider;
    runCompany = (interviewId: string, sessionId: string) =>
      defaultRunCompanyLiveTurn(getPrisma(), interviewId, sessionId, getLlmProvider());
  } else {
    runCompany = silentTurn;
  }

  let runCandidate: RunCandidateLiveTurnFn;
  if (options.runCandidateLiveTurn) {
    runCandidate = options.runCandidateLiveTurn;
  } else if (options.getLlmProvider) {
    const getLlmProvider = options.getLlmProvider;
    runCandidate = (interviewId: string, sessionId: string) =>
      defaultRunCandidateLiveTurn(getPrisma(), interviewId, sessionId, getLlmProvider());
  } else {
    runCandidate = silentTurn;
  }

  const rooms = new Map<string, RoomState>();

  function getState(interviewId: string): RoomState {
    let state = rooms.get(interviewId);
    if (!state) {
      state = { debounceTimer: null, generation: 0 };
      rooms.set(interviewId, state);
    }
    return state;
  }

  async function executeTurn(
    io: Server,
    interviewId: string,
    sessionId: string,
    capturedGeneration: number,
  ): Promise<void> {
    const state = getState(interviewId);
    const prisma = getPrisma();

    const steps: AgentStep[] = [
      { agentType: "AGENT_ARBITER", run: () => runArbiter(interviewId, sessionId) },
      { agentType: "AGENT_COMPANY", run: () => runCompany(interviewId, sessionId) },
      { agentType: "AGENT_CANDIDATE", run: () => runCandidate(interviewId, sessionId) },
    ];

    try {
      for (const step of steps) {
        if (state.generation !== capturedGeneration) {
          emitThinking(io, interviewId, { active: false });
          return;
        }

        emitThinking(io, interviewId, {
          active: true,
          agentType: step.agentType as RoomAgentThinkingEvent["agentType"],
        });

        try {
          const reply = await step.run();

          if (state.generation !== capturedGeneration) {
            emitThinking(io, interviewId, { active: false });
            return;
          }

          if (reply.post && reply.message) {
            const saved = await prisma.liveMessage.create({
              data: {
                sessionId,
                authorType: step.agentType,
                content: reply.message,
              },
            });

            io.to(roomName(interviewId)).emit("room:messages", {
              messages: [toDto(saved)],
            });
          }
        } catch (error) {
          console.error(
            `[orchestrator] ${step.agentType} turn failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    } finally {
      if (state.generation === capturedGeneration) {
        emitThinking(io, interviewId, { active: false });
      }
    }
  }

  function scheduleTurn(io: Server, interviewId: string, sessionId: string): void {
    const state = getState(interviewId);

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    state.generation += 1;
    emitThinking(io, interviewId, { active: false });

    const capturedGeneration = state.generation;
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      void executeTurn(io, interviewId, sessionId, capturedGeneration);
    }, debounceMs);
  }

  return {
    onHumanMessage(io: Server, interviewId: string, sessionId: string): void {
      void (async () => {
        const interview = await getPrisma().interview.findUnique({
          where: { id: interviewId },
          select: { status: true },
        });
        if (!interview || interview.status !== "LIVE") {
          return;
        }

        scheduleTurn(io, interviewId, sessionId);
      })();
    },
  };
}
