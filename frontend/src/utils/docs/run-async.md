---
type: TS Module
title: run-async.ts
resource: frontend/src/utils/run-async.ts
docgen:
  crc: a4a99af6
---

## Огляд

Fire-and-forget helper для Vue UI: запуск promise без await, помилки не пробивають потік.

## Публічний API

- `runFireAndForget(promise)` — запускає promise без очікування.
