import type { Server } from "socket.io";
import type { CandidateConfidence, LiveAuthorType, LiveMessage, PrismaClient } from "@prisma/client";
import type { ParsedPostReply } from "../agents/agent-post-reply";
import {
  runArbiterTurn as defaultRunArbiterTurn,
  type ParsedArbiterCommand,
} from "../agents/arbiter-agent";
import {
  runCompanyLiveTurn as defaultRunCompanyLiveTurn,
} from "../agents/company-live-agent";
import {
  runCandidateLiveTurn as defaultRunCandidateLiveTurn,
  toPrismaCandidateConfidence,
  type ParsedCandidateLiveReply,
} from "../agents/candidate-live-agent";
import type { LiveAgentTurnContext } from "../agents/live-agent-turn-context";
import type { LlmProvider } from "../llm/types";
import type {
  LiveMessageDto,
  RoomAgentThinkingEvent,
  RoomArbiterProcessEvent,
} from "./types";

export const AGENT_DEBOUNCE_MS = 1000;
export const MAX_CONDUCTOR_STEPS = 6;

type RoomState = {
  debounceTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
  candidateRecoveryTimer: ReturnType<typeof setTimeout> | null;
  pendingQuestion: boolean;
};

export type RunArbiterTurnFn = (
  interviewId: string,
  sessionId: string,
  pendingQuestion: boolean,
) => Promise<ParsedArbiterCommand>;

export type RunCompanyLiveTurnFn = (
  interviewId: string,
  sessionId: string,
  turnContext: LiveAgentTurnContext,
) => Promise<ParsedPostReply>;

export type RunCandidateLiveTurnFn = (
  interviewId: string,
  sessionId: string,
  turnContext: LiveAgentTurnContext,
) => Promise<ParsedCandidateLiveReply>;

export type RoomOrchestratorOptions = {
  debounceMs?: number;
  maxConductorSteps?: number;
  runArbiterTurn?: RunArbiterTurnFn;
  runCompanyLiveTurn?: RunCompanyLiveTurnFn;
  runCandidateLiveTurn?: RunCandidateLiveTurnFn;
  getLlmProvider?: () => LlmProvider;
};

export interface RoomOrchestrator {
  onHumanMessage(io: Server, interviewId: string, sessionId: string): void;
  onLiveStart(io: Server, interviewId: string, sessionId: string): void;
  close(): void;
}

const silentCompany: RunCompanyLiveTurnFn = async () => ({ post: false });
const silentCandidate: RunCandidateLiveTurnFn = async () => ({
  post: false,
  needsHuman: false,
});

function roomName(interviewId: string): string {
  return `interview:${interviewId}`;
}

function toDto(message: LiveMessage): LiveMessageDto {
  return {
    id: message.id,
    authorType: message.authorType,
    content: message.content,
    candidateConfidence: message.candidateConfidence ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

function emitThinking(io: Server, interviewId: string, payload: RoomAgentThinkingEvent): void {
  io.to(roomName(interviewId)).emit("room:agent-thinking", payload);
}

function emitArbiterProcess(
  io: Server,
  interviewId: string,
  command: ParsedArbiterCommand,
): void {
  const payload: RoomArbiterProcessEvent = {
    at: new Date().toISOString(),
    action: command.action,
    summaryUk: command.summaryUk,
  };
  io.to(roomName(interviewId)).emit("room:arbiter-process", payload);
}

function emitAgentError(
  io: Server,
  interviewId: string,
  agentType: LiveAuthorType,
  error: unknown,
): void {
  const raw = error instanceof Error ? error.message : String(error);
  io.to(roomName(interviewId)).emit("room:agent-error", {
    agentType: agentType as RoomAgentThinkingEvent["agentType"],
    error: raw.includes("перевищено ліміт")
      ? raw
      : "AI-агент тимчасово недоступний. Спробуйте надіслати повідомлення ще раз.",
  });
}

function applyPendingBeforeRoute(state: RoomState, action: ParsedArbiterCommand["action"]): void {
  if (
    action === "NEXT_QUESTION" ||
    action === "START" ||
    action === "CANDIDATE_QUESTIONS" ||
    action === "SUGGEST_END" ||
    action === "COMPANY_ANSWER"
  ) {
    state.pendingQuestion = false;
  }
  if (action === "ANSWER" || action === "CLARIFY") {
    state.pendingQuestion = true;
  }
}

export function createRoomOrchestrator(
  getPrisma: () => PrismaClient,
  options: RoomOrchestratorOptions = {},
): RoomOrchestrator {
  const debounceMs = options.debounceMs ?? AGENT_DEBOUNCE_MS;
  const maxConductorSteps = options.maxConductorSteps ?? MAX_CONDUCTOR_STEPS;

  const rooms = new Map<string, RoomState>();
  let closed = false;

  function getState(interviewId: string): RoomState {
    let state = rooms.get(interviewId);
    if (!state) {
      state = {
        debounceTimer: null,
        generation: 0,
        candidateRecoveryTimer: null,
        pendingQuestion: false,
      };
      rooms.set(interviewId, state);
    }
    return state;
  }

  let runArbiter: RunArbiterTurnFn;
  if (options.runArbiterTurn) {
    runArbiter = options.runArbiterTurn;
  } else if (options.getLlmProvider) {
    const getLlmProvider = options.getLlmProvider;
    runArbiter = (interviewId, sessionId, pendingQuestion) =>
      defaultRunArbiterTurn(getPrisma(), interviewId, sessionId, getLlmProvider(), {
        pendingQuestion,
      });
  } else {
    throw new Error("RoomOrchestrator requires runArbiterTurn or getLlmProvider");
  }

  let runCompany: RunCompanyLiveTurnFn;
  if (options.runCompanyLiveTurn) {
    runCompany = options.runCompanyLiveTurn;
  } else if (options.getLlmProvider) {
    const getLlmProvider = options.getLlmProvider;
    runCompany = (interviewId, sessionId, turnContext) =>
      defaultRunCompanyLiveTurn(
        getPrisma(),
        interviewId,
        sessionId,
        getLlmProvider(),
        turnContext,
      );
  } else {
    runCompany = silentCompany;
  }

  let runCandidate: RunCandidateLiveTurnFn;
  if (options.runCandidateLiveTurn) {
    runCandidate = options.runCandidateLiveTurn;
  } else if (options.getLlmProvider) {
    const getLlmProvider = options.getLlmProvider;
    runCandidate = (interviewId, sessionId, turnContext) =>
      defaultRunCandidateLiveTurn(
        getPrisma(),
        interviewId,
        sessionId,
        getLlmProvider(),
        turnContext,
      );
  } else {
    runCandidate = silentCandidate;
  }

  async function saveAndEmit(
    io: Server,
    prisma: PrismaClient,
    sessionId: string,
    interviewId: string,
    authorType: LiveAuthorType,
    content: string,
    candidateConfidence?: CandidateConfidence | null,
  ): Promise<LiveMessage> {
    const saved = await prisma.liveMessage.create({
      data: {
        sessionId,
        authorType,
        content,
        candidateConfidence: candidateConfidence ?? null,
      },
    });
    io.to(roomName(interviewId)).emit("room:messages", {
      messages: [toDto(saved)],
    });
    return saved;
  }

  async function executeTurn(
    io: Server,
    interviewId: string,
    sessionId: string,
    capturedGeneration: number,
  ): Promise<void> {
    if (closed) return;
    const state = getState(interviewId);
    const prisma = getPrisma();

    let companyPostedThisTurn = false;
    let candidatePostedThisTurn = false;
    let candidateStepFailed = false;
    let stepsUsed = 0;

    try {
      while (stepsUsed < maxConductorSteps) {
        if (state.generation !== capturedGeneration || closed) {
          emitThinking(io, interviewId, { active: false });
          return;
        }

        emitThinking(io, interviewId, {
          active: true,
          agentType: "AGENT_ARBITER",
        });

        let command: ParsedArbiterCommand;
        try {
          command = await runArbiter(interviewId, sessionId, state.pendingQuestion);
          stepsUsed += 1;
        } catch (error) {
          emitAgentError(io, interviewId, "AGENT_ARBITER", error);
          console.error(
            "[orchestrator] AGENT_ARBITER turn failed:",
            error instanceof Error ? error.message : error,
          );
          break;
        }

        if (state.generation !== capturedGeneration) {
          emitThinking(io, interviewId, { active: false });
          return;
        }

        emitArbiterProcess(io, interviewId, command);

        if (command.publicMessage) {
          await saveAndEmit(
            io,
            prisma,
            sessionId,
            interviewId,
            "AGENT_ARBITER",
            command.publicMessage,
          );
        }

        if (state.generation !== capturedGeneration) {
          emitThinking(io, interviewId, { active: false });
          return;
        }

        applyPendingBeforeRoute(state, command.action);

        if (command.action === "WAIT" || command.action === "SUGGEST_END") {
          break;
        }

        if (stepsUsed >= maxConductorSteps) {
          break;
        }

        const turnContext: LiveAgentTurnContext = {
          action:
            command.action === "START"
              ? "NEXT_QUESTION"
              : command.action === "CLARIFY"
                ? "CLARIFY"
                : command.action === "CANDIDATE_QUESTIONS"
                  ? "CANDIDATE_QUESTIONS"
                  : command.action === "ANSWER"
                    ? "ANSWER"
                    : command.action === "COMPANY_ANSWER"
                      ? "ANSWER_CANDIDATE"
                      : "NEXT_QUESTION",
          briefUk: command.briefUk,
        };

        const runCompanyActions =
          command.action === "START" ||
          command.action === "NEXT_QUESTION" ||
          command.action === "CLARIFY" ||
          command.action === "COMPANY_ANSWER";
        const runCandidateActions =
          command.action === "ANSWER" || command.action === "CANDIDATE_QUESTIONS";

        if (runCompanyActions) {
          emitThinking(io, interviewId, {
            active: true,
            agentType: "AGENT_COMPANY",
          });
          try {
            const reply = await runCompany(interviewId, sessionId, turnContext);
            stepsUsed += 1;
            if (state.generation !== capturedGeneration) {
              emitThinking(io, interviewId, { active: false });
              return;
            }
            if (reply.post && reply.message) {
              await saveAndEmit(
                io,
                prisma,
                sessionId,
                interviewId,
                "AGENT_COMPANY",
                reply.message,
              );
              companyPostedThisTurn = true;
              if (command.action !== "COMPANY_ANSWER") {
                state.pendingQuestion = true;
              }
            }
          } catch (error) {
            emitAgentError(io, interviewId, "AGENT_COMPANY", error);
            console.error(
              "[orchestrator] AGENT_COMPANY turn failed:",
              error instanceof Error ? error.message : error,
            );
            break;
          }
          continue;
        }

        if (runCandidateActions) {
          // Guardrail: never spam ANSWER after Candidate already spoke this turn
          if (candidatePostedThisTurn && command.action === "ANSWER") {
            break;
          }

          emitThinking(io, interviewId, {
            active: true,
            agentType: "AGENT_CANDIDATE",
          });
          try {
            const reply = await runCandidate(interviewId, sessionId, turnContext);
            stepsUsed += 1;
            if (state.generation !== capturedGeneration) {
              emitThinking(io, interviewId, { active: false });
              return;
            }
            if (reply.post && reply.message) {
              const prismaConfidence =
                reply.confidence != null
                  ? toPrismaCandidateConfidence(reply.confidence)
                  : null;
              await saveAndEmit(
                io,
                prisma,
                sessionId,
                interviewId,
                "AGENT_CANDIDATE",
                reply.message,
                prismaConfidence,
              );
              candidatePostedThisTurn = true;
            }

            // Silence or deferral to live human: stop conductor, keep pendingQuestion
            if (!reply.post || reply.needsHuman === true) {
              break;
            }
          } catch (error) {
            candidateStepFailed = true;
            emitAgentError(io, interviewId, "AGENT_CANDIDATE", error);
            console.error(
              "[orchestrator] AGENT_CANDIDATE turn failed:",
              error instanceof Error ? error.message : error,
            );
            break;
          }
          continue;
        }

        break;
      }
    } finally {
      if (state.generation === capturedGeneration) {
        emitThinking(io, interviewId, { active: false });
      }

      if (
        companyPostedThisTurn &&
        !candidatePostedThisTurn &&
        candidateStepFailed &&
        state.generation === capturedGeneration &&
        !state.candidateRecoveryTimer &&
        !closed
      ) {
        state.candidateRecoveryTimer = setTimeout(() => {
          state.candidateRecoveryTimer = null;
          scheduleTurn(io, interviewId, sessionId);
        }, 60_000);
      }
    }
  }

  function scheduleTurn(io: Server, interviewId: string, sessionId: string): void {
    if (closed) return;
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
      if (closed) return;
      void (async () => {
        if (closed) return;
        const interview = await getPrisma().interview.findUnique({
          where: { id: interviewId },
          select: { status: true },
        });
        if (closed || !interview || interview.status !== "LIVE") {
          return;
        }

        scheduleTurn(io, interviewId, sessionId);
      })();
    },

    onLiveStart(_io: Server, _interviewId: string, _sessionId: string): void {
      // Agents wait for HR to signal the start of the interview via a human message.
    },

    close(): void {
      if (closed) return;
      closed = true;
      for (const state of rooms.values()) {
        state.generation += 1;
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        if (state.candidateRecoveryTimer) {
          clearTimeout(state.candidateRecoveryTimer);
        }
      }
      rooms.clear();
    },
  };
}
