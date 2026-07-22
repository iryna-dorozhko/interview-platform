import { ref, type Ref } from "vue";
import {
  fetchDialogUnreadCount,
  markDialogRead as apiMarkDialogRead,
} from "../api/dialogs";

const DEFAULT_POLL_MS = 45_000;

export function formatUnreadBadge(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export type DialogUnreadAdapters = {
  fetchUnreadCount: () => Promise<number>;
  markDialogRead: (id: string) => Promise<void>;
};

export function createDialogUnreadController(
  adapters: DialogUnreadAdapters,
  pollMs: number = DEFAULT_POLL_MS,
) {
  const unreadCount = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      unreadCount.value = await adapters.fetchUnreadCount();
    } catch {
      // keep last known value
    }
  }

  async function markRead(dialogId: string): Promise<void> {
    await adapters.markDialogRead(dialogId);
    await refresh();
  }

  function startPolling(): void {
    stopPolling();
    void refresh();
    timer = setInterval(() => {
      void refresh();
    }, pollMs);
  }

  function stopPolling(): void {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { unreadCount, refresh, markRead, startPolling, stopPolling };
}

const shared = createDialogUnreadController({
  fetchUnreadCount: fetchDialogUnreadCount,
  markDialogRead: apiMarkDialogRead,
});

export function useDialogUnread(): {
  unreadCount: Ref<number>;
  refresh: () => Promise<void>;
  markRead: (dialogId: string) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
} {
  return shared;
}
