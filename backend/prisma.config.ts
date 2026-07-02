import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const defaultDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  },
});
