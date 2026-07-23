export function prepDurationMs(
  session: { isClosed: boolean; createdAt: Date; updatedAt: Date } | null,
): number | null {
  if (!session || !session.isClosed) return null;
  return session.updatedAt.getTime() - session.createdAt.getTime();
}

export function liveDurationMs(
  session: { startedAt: Date; endedAt: Date | null } | null,
): number | null {
  if (!session?.endedAt) return null;
  return session.endedAt.getTime() - session.startedAt.getTime();
}
