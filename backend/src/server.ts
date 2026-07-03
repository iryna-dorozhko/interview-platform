import "dotenv/config";
import cors from "cors";
import express from "express";
import { prisma } from "./db/prisma";
import { createHealthRouter } from "./routes/health";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use("/api", createHealthRouter(() => prisma));

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
