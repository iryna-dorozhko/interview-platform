import type { Server } from "socket.io";
import type { LiveAuthorType, LiveMessage, PrismaClient } from "@prisma/client";
import { runStubArbiter } from "../agents/stub-arbiter";
import type { LiveMessageDto, RoomAgentThinkingEvent } from "./types";

export const AGENT_DEBOUNCE_MS = 2500;

const HUMAN_AUTHOR_TYPES: LiveAuthorType[] = ["HUMAN_HR", "HUMAN_CANDIDATE"];

type RoomState = {
  debounceTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
};

export type RoomOrchestratorOptions = {
  debounceMs?: number;
  runAgent?: (lastHumanContent: string) => Promise<string>;
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
  const runAgent = options.runAgent ?? runStubArbiter;
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
      const lastHuman = await prisma.liveMessage.findFirst({
        where: {
          sessionId,
          authorType: { in: HUMAN_AUTHOR_TYPES },
        },
        orderBy: { createdAt: "desc" },
      });

      const content = await runAgent(lastHuman?.content ?? "");

      if (state.generation !== capturedGeneration) {
        emitThinking(io, interviewId, { active: false });
        return;
      }

      const saved = await prisma.liveMessage.create({
        data: {
          sessionId,
          authorType: "AGENT_ARBITER",
          content,
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

  return {
    onHumanMessage(io: Server, interviewId: string, sessionId: string): void {
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
    },
  };
}
