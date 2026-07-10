import type { Server, Socket } from "socket.io";
import type { LiveMessage, PrismaClient } from "@prisma/client";
import { attachSocketAuth, getSocketUser } from "./auth";
import { ensureLiveSession } from "./live-session";
import { canAccessInterviewRoom } from "./room-access";
import type { RoomOrchestrator } from "./orchestrator";
import type { LiveMessageDto, RoomJoinPayload, RoomMessagePayload } from "./types";

const MAX_CONTENT_LENGTH = 4000;

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

function authorTypeForUser(role: "HR" | "CANDIDATE"): "HUMAN_HR" | "HUMAN_CANDIDATE" {
  return role === "HR" ? "HUMAN_HR" : "HUMAN_CANDIDATE";
}

async function loadInterview(prisma: PrismaClient, interviewId: string) {
  return prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, hrUserId: true, candidateUserId: true, status: true },
  });
}

export function registerRoomHandlers(
  io: Server,
  getPrisma: () => PrismaClient,
  orchestrator: RoomOrchestrator,
): void {
  io.use((socket, next) => {
    if (attachSocketAuth(socket)) {
      next();
    } else {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on("room:join", async (payload: RoomJoinPayload) => {
      try {
        const user = getSocketUser(socket);
        if (!user) {
          socket.emit("room:error", { error: "Немає доступу" });
          return;
        }

        const interviewId =
          typeof payload?.interviewId === "string" ? payload.interviewId.trim() : "";
        if (!interviewId) {
          socket.emit("room:error", { error: "Невірний запит" });
          return;
        }

        const prisma = getPrisma();
        const interview = await loadInterview(prisma, interviewId);
        if (!interview) {
          socket.emit("room:error", { error: "Співбесіду не знайдено" });
          return;
        }

        const access = canAccessInterviewRoom(interview, user);
        if (!access.ok) {
          socket.emit("room:error", { error: access.error });
          return;
        }

        await socket.join(roomName(interviewId));
        const session = await ensureLiveSession(prisma, interviewId);

        if (interview.status === "READY") {
          await prisma.interview.update({
            where: { id: interviewId },
            data: { status: "LIVE" },
          });
          io.to(roomName(interviewId)).emit("room:status", { status: "LIVE" });
        }

        const messages = await prisma.liveMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: "asc" },
        });

        socket.emit("room:messages", { messages: messages.map(toDto) });
      } catch (error) {
        console.error("[room:join] failed:", error instanceof Error ? error.message : error);
        socket.emit("room:error", { error: "Внутрішня помилка кімнати" });
      }
    });

    socket.on("room:message", async (payload: RoomMessagePayload) => {
      try {
        const user = getSocketUser(socket);
        if (!user) {
          socket.emit("room:error", { error: "Немає доступу" });
          return;
        }

        const interviewId =
          typeof payload?.interviewId === "string" ? payload.interviewId.trim() : "";
        const content =
          typeof payload?.content === "string" ? payload.content.trim() : "";

        if (!interviewId) {
          socket.emit("room:error", { error: "Невірний запит" });
          return;
        }
        if (!content || content.length > MAX_CONTENT_LENGTH) {
          socket.emit("room:error", { error: "Порожнє або занадто довге повідомлення" });
          return;
        }

        const prisma = getPrisma();
        const interview = await loadInterview(prisma, interviewId);
        if (!interview) {
          socket.emit("room:error", { error: "Співбесіду не знайдено" });
          return;
        }

        if (interview.status === "ENDED") {
          socket.emit("room:error", { error: "Співбесіда завершена" });
          return;
        }

        const access = canAccessInterviewRoom(interview, user);
        if (!access.ok) {
          socket.emit("room:error", { error: access.error });
          return;
        }

        const session = await ensureLiveSession(prisma, interviewId);
        const saved = await prisma.liveMessage.create({
          data: {
            sessionId: session.id,
            authorType: authorTypeForUser(user.role),
            content,
          },
        });

        io.to(roomName(interviewId)).emit("room:messages", {
          messages: [toDto(saved)],
        });

        if (saved.authorType === "HUMAN_HR" || saved.authorType === "HUMAN_CANDIDATE") {
          orchestrator.onHumanMessage(io, interviewId, session.id);
        }
      } catch (error) {
        console.error("[room:message] failed:", error instanceof Error ? error.message : error);
        socket.emit("room:error", { error: "Внутрішня помилка кімнати" });
      }
    });
  });
}
