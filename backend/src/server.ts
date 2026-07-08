import "dotenv/config";
import cors from "cors";
import express from "express";
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

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json());

getJwtConfig();

app.use("/api", createHealthRouter(() => prisma));
app.use("/api", createAuthRouter(() => prisma));
// Candidate prep before requireHr stacks — otherwise requireHr rejects CANDIDATE on every /api request.
app.use(
  "/api",
  requireAuth,
  requireCandidate,
  createCandidatePrepRouter(() => prisma, () => createLlmProvider())
);
app.use("/api", requireAuth, requireHr, createLlmRouter(() => createLlmProvider()));
app.use("/api", requireAuth, requireHr, createPrepRouter(() => prisma, () => createLlmProvider()));
app.use("/api", requireAuth, requireHr, createInterviewsRouter(() => prisma));
app.use("/api", requireAuth, requireHr, createVacanciesRouter(() => prisma));

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
