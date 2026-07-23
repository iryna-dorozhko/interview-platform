import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { PrismaClient } from "@prisma/client";
import { signToken } from "../auth/jwt";
import { registerDialogHandlers } from "./dialogs";

process.env.JWT_SECRET = "test-secret-min-8-chars";

type FakeDialog = {
  id: string;
  hrUserId: string;
  candidateUserId: string;
};

function makeFakePrisma(dialog: FakeDialog | null) {
  return {
    dialog: {
      findUnique: async ({
        where,
      }: {
        where: { id: string };
        select?: { id: boolean; hrUserId: boolean; candidateUserId: boolean };
      }) => {
        if (!dialog || where.id !== dialog.id) return null;
        return {
          id: dialog.id,
          hrUserId: dialog.hrUserId,
          candidateUserId: dialog.candidateUserId,
        };
      },
    },
  } as unknown as PrismaClient;
}

async function startDialogServer(prisma: PrismaClient): Promise<{
  httpServer: HttpServer;
  port: number;
  close: () => Promise<void>;
}> {
  const httpServer = createServer();
  const io = new Server(httpServer);
  registerDialogHandlers(io, () => prisma);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return {
    httpServer,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        io.close();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function connectClient(port: number, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ["websocket"],
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) => reject(error));
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const hrToken = signToken({ sub: "hr_1", email: "hr@test.com", role: "HR" });
const candidateToken = signToken({
  sub: "cd_1",
  email: "candidate@test.com",
  role: "CANDIDATE",
});

test("dialog:join then dialog:typing relays to peer", async () => {
  const dialog: FakeDialog = {
    id: "dialog_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
  };
  const server = await startDialogServer(makeFakePrisma(dialog));

  try {
    const hrSocket = await connectClient(server.port, hrToken);
    const candidateSocket = await connectClient(server.port, candidateToken);

    hrSocket.emit("dialog:join", { dialogId: "dialog_1" });
    candidateSocket.emit("dialog:join", { dialogId: "dialog_1" });
    await new Promise((r) => setTimeout(r, 50));

    const peerTyping = waitForEvent<{ role: string; isTyping: boolean }>(
      candidateSocket,
      "dialog:typing",
    );
    hrSocket.emit("dialog:typing", { dialogId: "dialog_1", isTyping: true });
    const payload = await peerTyping;
    assert.equal(payload.role, "HR");
    assert.equal(payload.isTyping, true);

    hrSocket.disconnect();
    candidateSocket.disconnect();
  } finally {
    await server.close();
  }
});

test("dialog:join rejects non-participant", async () => {
  const dialog: FakeDialog = {
    id: "dialog_1",
    hrUserId: "hr_1",
    candidateUserId: "cd_1",
  };
  const server = await startDialogServer(makeFakePrisma(dialog));

  try {
    const socket = await connectClient(
      server.port,
      signToken({ sub: "hr_2", email: "other@test.com", role: "HR" }),
    );
    const errorPromise = waitForEvent<{ error: string }>(socket, "dialog:error");
    socket.emit("dialog:join", { dialogId: "dialog_1" });
    const payload = await errorPromise;
    assert.equal(payload.error, "Немає доступу");
    socket.disconnect();
  } finally {
    await server.close();
  }
});
