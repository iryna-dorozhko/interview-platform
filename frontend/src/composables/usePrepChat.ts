import { nextTick, ref, type Ref } from "vue";

export type PrepFailedAction = "greeting" | "message" | "finish";

export type PrepChatMessage = {
  id: string;
  authorType: string;
  content: string;
  createdAt: string;
};

export type PrepChatLoadResult<TProfile> = {
  messages: PrepChatMessage[];
  isClosed: boolean;
  profile: TProfile | null;
};

export type PrepChatAdapters<TProfile> = {
  loadState: () => Promise<PrepChatLoadResult<TProfile>>;
  sendMessage: (text?: string) => Promise<{
    message: string;
    readyForConfirmation: boolean;
  }>;
  finishChat: () => Promise<void | { profile: TProfile }>;
  deleteChat: () => Promise<void>;
  isUserMessage: (msg: PrepChatMessage) => boolean;
  humanAuthorType: string;
  agentAuthorType: string;
};

export type UsePrepChatOptions<TProfile> = {
  adapters: PrepChatAdapters<TProfile>;
  onFinished?: () => void;
  onDeleted?: () => void;
  onAfterLoad?: (state: PrepChatLoadResult<TProfile>) => void | Promise<void>;
  /** Default: `!state.isClosed && state.messages.length === 0` */
  shouldAutoGreet?: (state: PrepChatLoadResult<TProfile>) => boolean;
  confirmDeleteMessage?: string;
  confirmFinishWhenNotReadyMessage?: string;
};

const DEFAULT_DELETE_MSG = "Видалити всю історію чату? Цю дію не можна скасувати.";
const DEFAULT_FINISH_MSG =
  "Даних може бути недостатньо. Все одно завершити й сформувати профіль?";

export function usePrepChat<TProfile>(options: UsePrepChatOptions<TProfile>) {
  const { adapters } = options;
  const loadState = ref<"loading" | "ready" | "error">("loading");
  const errorMessage = ref<string | null>(null);
  const messages = ref<PrepChatMessage[]>([]) as Ref<PrepChatMessage[]>;
  const isClosed = ref(false);
  const profile = ref<TProfile | null>(null) as Ref<TProfile | null>;
  const input = ref("");
  const sending = ref(false);
  const lastFailedAction = ref<PrepFailedAction | null>(null);
  const lastReadyForConfirmation = ref(false);
  const messagesEl = ref<HTMLElement | null>(null);

  async function scrollToBottom(): Promise<void> {
    await nextTick();
    const el = messagesEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function triggerGreeting(): Promise<void> {
    sending.value = true;
    try {
      const response = await adapters.sendMessage();
      messages.value.push({
        id: `local_${Date.now()}`,
        authorType: adapters.agentAuthorType,
        content: response.message,
        createdAt: new Date().toISOString(),
      });
      lastReadyForConfirmation.value = response.readyForConfirmation;
      lastFailedAction.value = null;
      await scrollToBottom();
    } catch (error) {
      lastFailedAction.value = "greeting";
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
    } finally {
      sending.value = false;
    }
  }

  async function load(): Promise<void> {
    loadState.value = "loading";
    errorMessage.value = null;
    try {
      const state = await adapters.loadState();
      messages.value = state.messages;
      isClosed.value = state.isClosed;
      profile.value = state.profile;
      loadState.value = "ready";
      await options.onAfterLoad?.(state);

      const autoGreet =
        options.shouldAutoGreet?.(state) ??
        (!state.isClosed && state.messages.length === 0);
      if (autoGreet) {
        await triggerGreeting();
      }
    } catch (error) {
      loadState.value = "error";
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося завантажити анкету";
    }
  }

  async function send(): Promise<void> {
    const text = input.value.trim();
    if (!text || sending.value || isClosed.value) return;

    errorMessage.value = null;
    lastFailedAction.value = null;
    input.value = "";
    messages.value.push({
      id: `local_${Date.now()}`,
      authorType: adapters.humanAuthorType,
      content: text,
      createdAt: new Date().toISOString(),
    });
    await scrollToBottom();

    sending.value = true;
    try {
      const response = await adapters.sendMessage(text);
      messages.value.push({
        id: `local_${Date.now()}_reply`,
        authorType: adapters.agentAuthorType,
        content: response.message,
        createdAt: new Date().toISOString(),
      });
      lastReadyForConfirmation.value = response.readyForConfirmation;
      lastFailedAction.value = null;
      await scrollToBottom();
    } catch (error) {
      lastFailedAction.value = "message";
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
    } finally {
      sending.value = false;
    }
  }

  async function retry(): Promise<void> {
    if (!lastFailedAction.value || sending.value) return;
    const action = lastFailedAction.value;
    errorMessage.value = null;
    sending.value = true;
    try {
      if (action === "finish") {
        const result = await adapters.finishChat();
        if (result && "profile" in result) {
          profile.value = result.profile;
        }
        isClosed.value = true;
        options.onFinished?.();
      } else {
        const response = await adapters.sendMessage();
        messages.value.push({
          id: `local_${Date.now()}_reply`,
          authorType: adapters.agentAuthorType,
          content: response.message,
          createdAt: new Date().toISOString(),
        });
        lastReadyForConfirmation.value = response.readyForConfirmation;
        await scrollToBottom();
      }
      lastFailedAction.value = null;
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося отримати відповідь агента";
    } finally {
      sending.value = false;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function deleteChat(): Promise<void> {
    const msg = options.confirmDeleteMessage ?? DEFAULT_DELETE_MSG;
    if (!globalThis.confirm(msg)) return;

    errorMessage.value = null;
    try {
      await adapters.deleteChat();
      messages.value = [];
      isClosed.value = false;
      profile.value = null;
      lastReadyForConfirmation.value = false;
      options.onDeleted?.();
      const shouldGreet = options.shouldAutoGreet?.({
        messages: [],
        isClosed: false,
        profile: null,
      }) ?? true;
      if (shouldGreet) {
        await triggerGreeting();
      }
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося видалити чат";
    }
  }

  async function finish(): Promise<void> {
    if (!lastReadyForConfirmation.value) {
      const msg = options.confirmFinishWhenNotReadyMessage ?? DEFAULT_FINISH_MSG;
      if (!globalThis.confirm(msg)) return;
    }

    errorMessage.value = null;
    sending.value = true;
    try {
      const result = await adapters.finishChat();
      if (result && "profile" in result) {
        profile.value = result.profile;
      }
      isClosed.value = true;
      lastFailedAction.value = null;
      options.onFinished?.();
    } catch (error) {
      lastFailedAction.value = "finish";
      errorMessage.value =
        error instanceof Error ? error.message : "Не вдалося завершити чат";
    } finally {
      sending.value = false;
    }
  }

  return {
    loadState,
    errorMessage,
    messages,
    isClosed,
    profile,
    input,
    sending,
    lastFailedAction,
    lastReadyForConfirmation,
    messagesEl,
    load,
    send,
    retry,
    finish,
    deleteChat,
    onKeydown,
    scrollToBottom,
    isUserMessage: adapters.isUserMessage,
  };
}
