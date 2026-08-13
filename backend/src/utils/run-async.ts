/** Ігнорує помилку fire-and-forget promise — навмисно без логування. */
export function ignorePromiseError(): void {
  // Fire-and-forget: помилки не пробивають основний потік.
}

// Запускає promise без очікування; помилки не пробивають основний потік.
export function runFireAndForget(promise: Promise<unknown>): void {
  promise.catch(ignorePromiseError)
}
