import type { Server, Socket } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import { attachSocketAuth, getSocketUser } from "./auth";
import type {
  DialogJoinPayload,
  DialogMessageDto,
  DialogTypingPayload,
} from "./types";

type DialogSocketData = {
  dialogId?: string;
  dialogRole?: "HR" | "CANDIDATE";
};

export function dialogRoomName(dialogId: string): string {
  return `dialog:${dialogId}`;
}

export function emitDialogMessage(
  io: Server,
  dialogId: string,
  message: DialogMessageDto,
): void {
  io.to(dialogRoomName(dialogId)).emit("dialog:message", { message });
}

function getData(socket: Socket): DialogSocketData {
  return socket.data as DialogSocketData;
}

export function registerDialogHandlers(
  io: Server,
  getPrisma: () => PrismaClient,
): void {
  io.use((socket, next) => {
    if (attachSocketAuth(socket)) next();
    else next(new Error("Unauthorized"));
  });

  io.on("connection", (socket: Socket) => {
    socket.on("dialog:join", async (payload: DialogJoinPayload) => {
      try {
        const user = getSocketUser(socket);
        if (!user) {
          socket.emit("dialog:error", { error: "Немає доступу" });
          return;
        }
        const dialogId =
          typeof payload?.dialogId === "string" ? payload.dialogId.trim() : "";
        if (!dialogId) {
          socket.emit("dialog:error", { error: "Невірний запит" });
          return;
        }
        const dialog = await getPrisma().dialog.findUnique({
          where: { id: dialogId },
          select: { id: true, hrUserId: true, candidateUserId: true },
        });
        if (
          !dialog ||
          (dialog.hrUserId !== user.id && dialog.candidateUserId !== user.id)
        ) {
          socket.emit("dialog:error", { error: "Немає доступу" });
          return;
        }
        const prev = getData(socket).dialogId;
        if (prev && prev !== dialogId) {
          await socket.leave(dialogRoomName(prev));
        }
        await socket.join(dialogRoomName(dialogId));
        getData(socket).dialogId = dialogId;
        getData(socket).dialogRole =
          dialog.hrUserId === user.id ? "HR" : "CANDIDATE";
      } catch (error) {
        console.error(
          "[dialog:join] failed:",
          error instanceof Error ? error.message : error,
        );
        socket.emit("dialog:error", { error: "Внутрішня помилка діалогу" });
      }
    });

    socket.on("dialog:typing", (payload: DialogTypingPayload) => {
      const user = getSocketUser(socket);
      if (!user) return;
      const data = getData(socket);
      const dialogId =
        typeof payload?.dialogId === "string" ? payload.dialogId.trim() : "";
      if (!dialogId || data.dialogId !== dialogId || !data.dialogRole) return;
      if (typeof payload?.isTyping !== "boolean") return;
      socket.to(dialogRoomName(dialogId)).emit("dialog:typing", {
        role: data.dialogRole,
        isTyping: payload.isTyping,
      });
    });

    socket.on("disconnect", () => {
      const data = getData(socket);
      if (!data.dialogId || !data.dialogRole) return;
      socket.to(dialogRoomName(data.dialogId)).emit("dialog:typing", {
        role: data.dialogRole,
        isTyping: false,
      });
    });
  });
}
