import type { Server } from "socket.io";
import type { LiveMessage, PrismaClient } from "@prisma/client";
import type { ParsedArbiterReply } from "../agents/arbiter-agent";
import { runArbiterTurn as defaultRunArbiterTurn } from "../agents/arbiter-agent";
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
) => Promise<ParsedArbiterReply>;

export type RoomOrchestratorOptions = {
  debounceMs?: number;
  runArbiterTurn?: RunArbiterTurnFn;
  getLlmProvider?: () => LlmProvider;
};

export interface RoomOrchestrator {
  onHumanMessage(io: Server, interviewId: string, sessionId: string): void;
}

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
  const getLlmProvider = options.getLlmProvider;
  const runArbiter =
    options.runArbiterTurn ??
    (getLlmProvider
      ? (interviewId: string, sessionId: string) =>
          defaultRunArbiterTurn(getPrisma(), interviewId, sessionId, getLlmProvider())
      : undefined);

  if (!runArbiter) {
    throw new Error("RoomOrchestrator requires runArbiterTurn or getLlmProvider");
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

    emitThinking(io, interviewId, { active: true, agentType: "AGENT_ARBITER" });

    try {
      const reply = await runArbiter(interviewId, sessionId);

      if (state.generation !== capturedGeneration) {
        emitThinking(io, interviewId, { active: false });
        return;
      }

      if (!reply.post) {
        emitThinking(io, interviewId, { active: false });
        return;
      }

      const saved = await prisma.liveMessage.create({
        data: {
          sessionId,
          authorType: "AGENT_ARBITER",
          content: reply.message!,
        },
      });

      io.to(roomName(interviewId)).emit("room:messages", {
        messages: [toDto(saved)],
      });
    } catch (error) {
      console.error(
        "[orchestrator] agent turn failed:",
        error instanceof Error ? error.message : error,
      );
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
