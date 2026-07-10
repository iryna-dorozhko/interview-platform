import { io, type Socket } from "socket.io-client";
import { getStoredToken } from "./client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      auth: {
        token: getStoredToken() ?? "",
      },
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const client = getSocket();
  const token = getStoredToken() ?? "";
  client.auth = { token };
  if (!client.connected) {
    client.connect();
  }
  return client;
}
