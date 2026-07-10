import type { Server } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import type { RoomPresence } from "./room-presence";

export function shouldTransitionToLive(
  status: string,
  presence: RoomPresence,
): boolean {
  return (
    status === "READY" &&
    presence.hrCount > 0 &&
    presence.candidateCount > 0
  );
}

export function roomName(interviewId: string): string {
  return `interview:${interviewId}`;
}

export async function maybeTransitionToLive(
  io: Server,
  prisma: PrismaClient,
  interviewId: string,
  presence: RoomPresence,
): Promise<void> {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
  if (!interview || !shouldTransitionToLive(interview.status, presence)) {
    return;
  }

  await prisma.interview.update({
    where: { id: interviewId },
    data: { status: "LIVE" },
  });

  io.to(roomName(interviewId)).emit("room:status", { status: "LIVE" });
}
