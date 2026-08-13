/**
 *
 */
function ignorePromiseError(): void {
  // Fire-and-forget: помилки не пробивають UI-потік.
}

// Запускає promise без очікування; помилки не пробивають UI-потік.
export function runFireAndForget(promise: Promise<unknown>): void {
  promise.catch(ignorePromiseError)
}
