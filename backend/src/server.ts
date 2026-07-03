import "dotenv/config";
import cors from "cors";
import express from "express";
import { prisma } from "./db/prisma";
import { createLlmProvider } from "./llm/factory";
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

app.use("/api", createHealthRouter(() => prisma));
app.use("/api", createLlmRouter(() => createLlmProvider()));

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
