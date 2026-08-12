---
type: TS Module
title: create-prisma-client.ts
resource: backend/src/db/create-prisma-client.ts
docgen:
  crc: 2af0b01c
---

## Огляд

Фабрика PrismaClient через @qzsy/prisma-adapter-bun (Bun native SQL), без pg Pool.

## Публічний API

- defaultDatabaseUrl — fallback PostgreSQL URL.
- createPrismaClient(databaseUrl?) — singleton-ready PrismaClient.
