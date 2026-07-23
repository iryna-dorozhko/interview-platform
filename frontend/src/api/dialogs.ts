import { fetchWithAuth } from "./client";

export type DialogMessageKind = "USER" | "DECISION_LETTER";
export type InterviewDecisionType = "ACCEPT" | "REJECT" | "ADDITIONAL_MEETING";

export type DialogListItem = {
  id: string;
  peer: { id: string; email: string };
  lastMessage: { body: string; createdAt: string; kind: DialogMessageKind } | null;
  updatedAt: string;
  unreadCount: number;
};

export type DialogMessage = {
  id: string;
  senderUserId: string;
  body: string;
  kind: DialogMessageKind;
  createdAt: string;
  decisionType: InterviewDecisionType | null;
};

export type DialogDetail = {
  id: string;
  hrUserId: string;
  candidateUserId: string;
  createdAt: string;
  updatedAt: string;
};

type ErrorBody = { error?: string; detail?: string };

async function parseError(response: Response, fallback: string): Promise<Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // ignore
  }
  const detail = body.detail ?? body.error;
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
}

type BackendDialogMessage = {
  id: string;
  senderUserId: string;
  body: string;
  kind: DialogMessageKind;
  createdAt: string;
  decision?: { type: InterviewDecisionType } | null;
};

function mapDialogMessage(message: BackendDialogMessage): DialogMessage {
  return {
    id: message.id,
    senderUserId: message.senderUserId,
    body: message.body,
    kind: message.kind,
    createdAt: message.createdAt,
    decisionType: message.decision?.type ?? null,
  };
}

export async function fetchDialogs(): Promise<DialogListItem[]> {
  const response = await fetchWithAuth("/api/dialogs");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити діалоги");
  }
  const body = (await response.json()) as { dialogs: DialogListItem[] };
  return body.dialogs.map((dialog) => ({
    ...dialog,
    unreadCount: Number(dialog.unreadCount ?? 0),
  }));
}

export async function fetchDialogUnreadCount(): Promise<number> {
  const response = await fetchWithAuth("/api/dialogs/unread-count");
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити непрочитані");
  }
  const body = (await response.json()) as { unreadCount: number };
  return body.unreadCount;
}

export async function markDialogRead(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/dialogs/${id}/read`, {
    method: "POST",
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося позначити діалог прочитаним");
  }
}

export async function createDialog(candidateUserId: string): Promise<{ id: string }> {
  const response = await fetchWithAuth("/api/dialogs", {
    method: "POST",
    body: JSON.stringify({ candidateUserId }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося створити діалог");
  }
  const body = (await response.json()) as {
    dialog: { id: string; hrUserId: string; candidateUserId: string };
  };
  return { id: body.dialog.id };
}

export async function fetchDialog(id: string): Promise<{
  dialog: DialogDetail;
  messages: DialogMessage[];
}> {
  const response = await fetchWithAuth(`/api/dialogs/${id}`);
  if (!response.ok) {
    throw await parseError(response, "Не вдалося завантажити діалог");
  }
  const body = (await response.json()) as {
    dialog: DialogDetail;
    messages: BackendDialogMessage[];
  };
  return {
    dialog: body.dialog,
    messages: body.messages.map(mapDialogMessage),
  };
}

export async function sendDialogMessage(id: string, body: string): Promise<DialogMessage> {
  const response = await fetchWithAuth(`/api/dialogs/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося надіслати повідомлення");
  }
  const payload = (await response.json()) as { message: BackendDialogMessage };
  return mapDialogMessage(payload.message);
}

export async function deleteDialog(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/dialogs/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await parseError(response, "Не вдалося видалити діалог");
  }
}
