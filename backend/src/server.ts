import "dotenv/config";
import cors from "cors";
import express from "express";
import { getJwtConfig } from "./auth/jwt";
import { requireAuth, requireHr } from "./auth/middleware";
import { prisma } from "./db/prisma";
import { createLlmProvider } from "./llm/factory";
import { createAuthRouter } from "./routes/auth";
import { createHealthRouter } from "./routes/health";
import { createLlmRouter } from "./routes/llm";

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
app.use("/api", requireAuth, requireHr, createLlmRouter(() => createLlmProvider()));

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
