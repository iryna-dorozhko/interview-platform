import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { getJwtConfig } from "./auth/jwt";
import { requireAuth, requireHr, requireCandidate } from "./auth/middleware";
import { disconnectPrisma, prisma } from "./db/prisma";
import { createLlmProvider } from "./llm/factory";
import { createAuthRouter } from "./routes/auth";
import { createHealthRouter } from "./routes/health";
import { createInterviewsRouter } from "./routes/interviews";
import { createReportsRouter } from "./routes/reports";
import { createVacanciesRouter } from "./routes/vacancies";
import { createLlmRouter } from "./routes/llm";
import { createPrepRouter } from "./routes/prep";
import { createCandidatePrepRouter } from "./routes/candidate-prep";
import { createCandidateInterviewRouter } from "./routes/candidate-interview";
import { createCandidateInvitationsRouter } from "./routes/candidate-invitations";
import { createRoomOrchestrator } from "./socket/orchestrator";
import { registerRoomHandlers } from "./socket/room";
import { createGracefulShutdown } from "./server-lifecycle";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(
  cors({
    origin: "http://localhost:5173",
  }),
);

app.use(express.json());

getJwtConfig();
const llmProvider = createLlmProvider();
const getLlmProvider = () => llmProvider;

app.use("/api", createHealthRouter(() => prisma));
app.use("/api", createAuthRouter(() => prisma));
app.use(
  "/api/candidate-prep",
  requireAuth,
  requireCandidate,
  createCandidatePrepRouter(() => prisma, getLlmProvider),
);
app.use("/api/candidate", createCandidateInterviewRouter(() => prisma));
app.use("/api/candidate", createCandidateInvitationsRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createLlmRouter(getLlmProvider));
app.use("/api", requireAuth, requireHr, createPrepRouter(() => prisma, getLlmProvider));
app.use("/api", requireAuth, requireHr, createInterviewsRouter(() => prisma, () => io, getLlmProvider));
app.use("/api", requireAuth, requireHr, createVacanciesRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createReportsRouter(() => prisma));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
  },
});

const orchestrator = createRoomOrchestrator(() => prisma, {
  getLlmProvider,
});
registerRoomHandlers(io, () => prisma, orchestrator);

function stopHttp(): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (
        error &&
        (!("code" in error) || error.code !== "ERR_SERVER_NOT_RUNNING")
      ) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function closeSocketIo(): Promise<void> {
  return new Promise((resolve, reject) => {
    io.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const shutdown = createGracefulShutdown({
  stopHttp,
  closeSocketIo,
  closeOrchestrator: () => orchestrator.close(),
  closeLlm: () => llmProvider.close?.() ?? Promise.resolve(),
  disconnectPrisma,
  logError: (error) => {
    console.error("[shutdown]", error);
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

httpServer.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
