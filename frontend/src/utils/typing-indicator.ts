export function typingLabelFor(role: "HR" | "CANDIDATE"): string {
  return role === "HR" ? "Рекрутер друкує" : "Кандидат друкує";
}

export function createTypingEmitter(options: {
  emit: (isTyping: boolean) => void;
  throttleMs?: number;
  idleMs?: number;
}): {
  onInput(text: string): void;
  onSend(): void;
  dispose(): void;
} {
  const throttleMs = options.throttleMs ?? 500;
  const idleMs = options.idleMs ?? 2500;
  let lastTrueAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let isTyping = false;

  function clearIdle(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function setFalse(): void {
    clearIdle();
    if (!isTyping) return;
    isTyping = false;
    options.emit(false);
  }

  function setTrue(): void {
    const now = Date.now();
    if (!isTyping) {
      isTyping = true;
      lastTrueAt = now;
      options.emit(true);
    } else if (now - lastTrueAt >= throttleMs) {
      lastTrueAt = now;
      options.emit(true);
    }
    clearIdle();
    idleTimer = setTimeout(() => setFalse(), idleMs);
  }

  return {
    onInput(text: string) {
      if (!text.trim()) {
        setFalse();
        return;
      }
      setTrue();
    },
    onSend() {
      setFalse();
    },
    dispose() {
      clearIdle();
    },
  };
}
