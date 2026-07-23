import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type Ref,
} from "vue";
import {
  fetchDialog,
  mapDialogMessage,
  sendDialogMessage,
  type BackendDialogMessage,
  type DialogDetail,
  type DialogMessage,
} from "../api/dialogs";
import { connectSocket } from "../api/socket";
import { createTypingEmitter, typingLabelFor } from "../utils/typing-indicator";

export type DialogThreadLoadState = "loading" | "ready" | "error";

export function useDialogThread(
  dialogId: Ref<string>,
  options: {
    currentUserId: Ref<string | null>;
    onLoaded?: (dialogId: string) => Promise<void> | void;
  },
) {
  const loadState = ref<DialogThreadLoadState>("loading");
  const loadError = ref<string | null>(null);
  const messages = ref<DialogMessage[]>([]);
  const dialog = ref<DialogDetail | null>(null);
  const draft = ref("");
  const sending = ref(false);
  const sendError = ref<string | null>(null);
  const peerTypingRole = ref<"HR" | "CANDIDATE" | null>(null);

  const socket = connectSocket();

  const currentRole = computed<"HR" | "CANDIDATE" | null>(() => {
    const d = dialog.value;
    const uid = options.currentUserId.value;
    if (!d || !uid) return null;
    if (d.hrUserId === uid) return "HR";
    if (d.candidateUserId === uid) return "CANDIDATE";
    return null;
  });

  const peerTypingLabel = computed(() =>
    peerTypingRole.value ? typingLabelFor(peerTypingRole.value) : null,
  );

  const typingEmitter = createTypingEmitter({
    emit: (isTyping) => {
      const id = dialogId.value;
      if (!id) return;
      socket.emit("dialog:typing", { dialogId: id, isTyping });
    },
  });

  function mergeMessage(incoming: DialogMessage): void {
    const byId = new Map(messages.value.map((item) => [item.id, item]));
    byId.set(incoming.id, incoming);
    messages.value = [...byId.values()].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  function onSocketMessage(payload: { message?: BackendDialogMessage & { dialogId?: string } }): void {
    if (!payload?.message?.id) return;
    mergeMessage(mapDialogMessage(payload.message));
    peerTypingRole.value = null;
  }

  function onSocketTyping(payload: { role?: "HR" | "CANDIDATE"; isTyping?: boolean }): void {
    if (payload?.role !== "HR" && payload?.role !== "CANDIDATE") return;
    if (typeof payload.isTyping !== "boolean") return;
    if (currentRole.value && payload.role === currentRole.value) return;
    peerTypingRole.value = payload.isTyping ? payload.role : null;
  }

  function joinDialogRoom(id: string): void {
    socket.emit("dialog:join", { dialogId: id });
  }

  async function loadThread(): Promise<void> {
    loadState.value = "loading";
    loadError.value = null;
    sendError.value = null;
    draft.value = "";
    messages.value = [];
    dialog.value = null;
    peerTypingRole.value = null;
    typingEmitter.onSend();

    const id = dialogId.value;
    try {
      const thread = await fetchDialog(id);
      dialog.value = thread.dialog;
      messages.value = thread.messages;
      loadState.value = "ready";
      joinDialogRoom(id);
      if (options.onLoaded) {
        await options.onLoaded(id);
      }
    } catch (error) {
      loadState.value = "error";
      loadError.value =
        error instanceof Error ? error.message : "Не вдалося завантажити діалог";
    }
  }

  function notifyTypingInput(text: string): void {
    typingEmitter.onInput(text);
  }

  async function send(): Promise<void> {
    const body = draft.value.trim();
    if (!body || sending.value) return;
    sending.value = true;
    sendError.value = null;
    typingEmitter.onSend();
    try {
      const message = await sendDialogMessage(dialogId.value, body);
      mergeMessage(message);
      draft.value = "";
    } catch (error) {
      sendError.value =
        error instanceof Error ? error.message : "Не вдалося надіслати повідомлення";
    } finally {
      sending.value = false;
    }
  }

  onMounted(() => {
    socket.on("dialog:message", onSocketMessage);
    socket.on("dialog:typing", onSocketTyping);
    if (!socket.connected) {
      socket.connect();
    }
    void loadThread();
  });

  watch(dialogId, () => {
    void loadThread();
  });

  onUnmounted(() => {
    socket.off("dialog:message", onSocketMessage);
    socket.off("dialog:typing", onSocketTyping);
    typingEmitter.dispose();
  });

  return {
    loadState,
    loadError,
    messages,
    dialog,
    draft,
    sending,
    sendError,
    peerTypingLabel,
    notifyTypingInput,
    send,
    reload: loadThread,
  };
}
