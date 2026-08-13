// Нативний confirm до появи модального UI.
export function confirmDestructiveAction(message: string): boolean {
  // oxlint-disable-next-line eslint/no-alert -- браузерний confirm як єдиний діалог підтвердження
  return globalThis.confirm(message)
}
