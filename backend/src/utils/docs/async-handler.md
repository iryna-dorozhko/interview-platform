---
type: TS Module
title: async-handler.ts
resource: backend/src/utils/async-handler.ts
docgen:
  crc: eaca7206
---

## Огляд

Обгортка async Express handler: rejection передається в `next()`.

## Публічний API

- `asyncHandler(handler)` — повертає `RequestHandler` для async route logic.
