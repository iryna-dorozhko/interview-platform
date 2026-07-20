import type { Server, Socket } from "socket.io";
import type { LiveMessage, PrismaClient } from "@prisma/client";
import { attachSocketAuth, getSocketUser } from "./auth";
import { ensureLiveSession } from "./live-session";
import { canAccessInterviewRoom } from "./room-access";
import { maybeTransitionToLive, roomName } from "./maybe-transition-live";
import { getPresence, trackJoin, trackLeave } from "./room-presence";
import type { RoomOrchestrator } from "./orchestrator";
import type { LiveMessageDto, RoomJoinPayload, RoomMessagePayload } from "./types";

const MAX_CONTENT_LENGTH = 4000;

type RoomSocketData = {
  interviewId?: string;
  roomRole?: "HR" | "CANDIDATE";
};

function toDto(message: LiveMessage): LiveMessageDto {
  return {
    id: message.id,
    authorType: message.authorType,
    content: message.content,
    candidateConfidence: message.candidateConfidence ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

function authorTypeForUser(role: "HR" | "CANDIDATE"): "HUMAN_HR" | "HUMAN_CANDIDATE" {
  return role === "HR" ? "HUMAN_HR" : "HUMAN_CANDIDATE";
}

function socketRole(userRole: "HR" | "CANDIDATE"): "HR" | "CANDIDATE" {
  return userRole;
}

async function loadInterview(prisma: PrismaClient, interviewId: string) {
  return prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, hrUserId: true, candidateUserId: true, status: true },
  });
}

function getSocketData(socket: Socket): RoomSocketData {
  return socket.data as RoomSocketData;
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

        const role = socketRole(user.role);
        const room = roomName(interviewId);

        await socket.join(room);
        getSocketData(socket).interviewId = interviewId;
        getSocketData(socket).roomRole = role;

        trackJoin(room, role);
        const session = await ensureLiveSession(prisma, interviewId);

        const transitioned = await maybeTransitionToLive(io, prisma, interviewId, getPresence(room));
        if (transitioned) {
          orchestrator.onLiveStart(io, interviewId, session.id);
        }

        const messages = await prisma.liveMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: "asc" },
        });

        socket.emit("room:messages", { messages: messages.map(toDto) });

        const updated = await loadInterview(prisma, interviewId);
        if (updated) {
          socket.emit("room:status", { status: updated.status });
        }
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

        const access = canAccessInterviewRoom(interview, user);
        if (!access.ok) {
          socket.emit("room:error", { error: access.error });
          return;
        }
        if (access.readOnly) {
          socket.emit("room:error", { error: "Співбесіда завершена" });
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

    socket.on("disconnect", () => {
      const data = getSocketData(socket);
      if (!data.interviewId || !data.roomRole) return;

      const room = roomName(data.interviewId);
      trackLeave(room, data.roomRole);
      void maybeTransitionToLive(io, getPrisma(), data.interviewId, getPresence(room));
    });
  });
}
