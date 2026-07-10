import type { Socket } from "socket.io";
import { verifyToken } from "../auth/jwt";
import type { AuthUser } from "../auth/middleware";

declare module "socket.io" {
  interface SocketData {
    user?: AuthUser;
  }
}

export function getSocketUser(socket: Socket): AuthUser | null {
  return socket.data.user ?? null;
}

export function attachSocketAuth(socket: Socket): boolean {
  const raw = socket.handshake.auth?.token;
  if (typeof raw !== "string" || !raw.trim()) {
    return false;
  }

  try {
    const payload = verifyToken(raw.trim());
    socket.data.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return true;
  } catch {
    return false;
  }
}
