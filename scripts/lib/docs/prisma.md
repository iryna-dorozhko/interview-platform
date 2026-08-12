---
type: JS Module
title: prisma.mjs
resource: scripts/lib/prisma.mjs
docgen:
  crc: de0b651b
---

## Огляд

Хелпер для root-скриптів: створює PrismaClient через backend createPrismaClient.

## Публічний API

- getPrisma() — повертає { prisma }.
- withPrisma(fn) — callback з auto $disconnect.
