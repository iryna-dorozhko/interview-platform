import { setTimeout as sleep } from 'node:timers/promises'

export const STUB_AGENT_DELAY_MS = 1500

const MAX_QUOTE_LENGTH = 80

// Будує StubArbiterReply.
export function buildStubArbiterReply(lastHumanContent: string): string {
  const quote =
    lastHumanContent.length > MAX_QUOTE_LENGTH ? `${lastHumanContent.slice(0, MAX_QUOTE_LENGTH)}` : lastHumanContent
  return `[Arbiter stub] Почув вас. Продовжуйте розмову. (Останнє: «${quote}»)`
}

// Модуль runStubArbiter.
export async function runStubArbiter(lastHumanContent: string): Promise<string> {
  await sleep(STUB_AGENT_DELAY_MS)
  return buildStubArbiterReply(lastHumanContent)
}
