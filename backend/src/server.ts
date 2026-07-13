import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { getJwtConfig } from "./auth/jwt";
import { requireAuth, requireHr, requireCandidate } from "./auth/middleware";
import { prisma } from "./db/prisma";
import { createLlmProvider } from "./llm/factory";
import { createAuthRouter } from "./routes/auth";
import { createHealthRouter } from "./routes/health";
import { createInterviewsRouter } from "./routes/interviews";
import { createVacanciesRouter } from "./routes/vacancies";
import { createLlmRouter } from "./routes/llm";
import { createPrepRouter } from "./routes/prep";
import { createCandidatePrepRouter } from "./routes/candidate-prep";
import { createCandidateInterviewRouter } from "./routes/candidate-interview";
import { createRoomOrchestrator } from "./socket/orchestrator";
import { registerRoomHandlers } from "./socket/room";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(
  cors({
    origin: "http://localhost:5173",
  }),
);

app.use(express.json());

getJwtConfig();

app.use("/api", createHealthRouter(() => prisma));
app.use("/api", createAuthRouter(() => prisma));
app.use(
  "/api/candidate-prep",
  requireAuth,
  requireCandidate,
  createCandidatePrepRouter(() => prisma, () => createLlmProvider()),
);
app.use("/api/candidate", createCandidateInterviewRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createLlmRouter(() => createLlmProvider()));
app.use("/api", requireAuth, requireHr, createPrepRouter(() => prisma, () => createLlmProvider()));
app.use("/api", requireAuth, requireHr, createInterviewsRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createVacanciesRouter(() => prisma));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
  },
});

const orchestrator = createRoomOrchestrator(() => prisma, {
  getLlmProvider: () => createLlmProvider(),
});
registerRoomHandlers(io, () => prisma, orchestrator);

httpServer.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
