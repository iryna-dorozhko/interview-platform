---
type: TS Module
title: run-async.ts
resource: backend/src/utils/run-async.ts
docgen:
  crc: f0d7e8ae
---

## Огляд

Утиліти fire-and-forget для backend: ігнорування помилок promise і запуск без await.

## Публічний API

- `ignorePromiseError()` — callback для `.catch`, навмисно без логування.
- `runFireAndForget(promise)` — запускає promise без очікування.
