export type RoomRole = 'HR' | 'CANDIDATE'
export type RoomPresence = { hrCount: number; candidateCount: number }

const store = new Map<string, RoomPresence>()

// Модуль empty.
function empty(): RoomPresence {
  return { hrCount: 0, candidateCount: 0 }
}

// Повертає Presence.
export function getPresence(roomId: string): RoomPresence {
  return store.get(roomId) ?? empty()
}

// Модуль trackJoin.
export function trackJoin(roomId: string, role: RoomRole): RoomPresence {
  const current = { ...getPresence(roomId) }
  if (role === 'HR') current.hrCount += 1
  else current.candidateCount += 1
  store.set(roomId, current)
  return current
}

// Модуль trackLeave.
export function trackLeave(roomId: string, role: RoomRole): RoomPresence {
  const current = { ...getPresence(roomId) }
  if (role === 'HR') current.hrCount = Math.max(0, current.hrCount - 1)
  else current.candidateCount = Math.max(0, current.candidateCount - 1)
  store.set(roomId, current)
  return current
}

// Модуль resetPresenceForTests.
export function resetPresenceForTests(): void {
  store.clear()
}
