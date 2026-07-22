import assert from "node:assert/strict";
import { test } from "node:test";
import { usePrepChat, type PrepChatAdapters, type PrepChatMessage } from "./usePrepChat";

type Profile = { confirmedAt: string | null };

function makeAdapters(overrides: Partial<PrepChatAdapters<Profile>> = {}): PrepChatAdapters<Profile> {
  return {
    loadState: async () => ({ messages: [], isClosed: false, profile: null }),
    sendMessage: async () => ({ message: "agent hi", readyForConfirmation: false }),
    finishChat: async () => ({ profile: { confirmedAt: null } }),
    deleteChat: async () => undefined,
    isUserMessage: (msg) => msg.authorType === "HUMAN_HR",
    humanAuthorType: "HUMAN_HR",
    agentAuthorType: "AGENT_COMPANY",
    ...overrides,
  };
}

test("load with empty messages triggers greeting", async () => {
  let sendCalls = 0;
  const chat = usePrepChat({
    adapters: makeAdapters({
      sendMessage: async () => {
        sendCalls += 1;
        return { message: "Вітаю!", readyForConfirmation: false };
      },
    }),
  });
  await chat.load();
  assert.equal(chat.loadState.value, "ready");
  assert.equal(sendCalls, 1);
  assert.equal(chat.messages.value.length, 1);
  assert.equal(chat.messages.value[0]?.authorType, "AGENT_COMPANY");
  assert.equal(chat.messages.value[0]?.content, "Вітаю!");
});

test("shouldAutoGreet false skips greeting", async () => {
  let sendCalls = 0;
  const chat = usePrepChat({
    adapters: makeAdapters({
      sendMessage: async () => {
        sendCalls += 1;
        return { message: "nope", readyForConfirmation: false };
      },
    }),
    shouldAutoGreet: () => false,
  });
  await chat.load();
  assert.equal(sendCalls, 0);
  assert.equal(chat.messages.value.length, 0);
});

test("send adds optimistic user message then agent reply", async () => {
  const chat = usePrepChat({
    adapters: makeAdapters({
      loadState: async () => ({
        messages: [
          {
            id: "1",
            authorType: "AGENT_COMPANY",
            content: "hi",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ] satisfies PrepChatMessage[],
        isClosed: false,
        profile: null,
      }),
      sendMessage: async (text) => {
        assert.equal(text, "мій досвід");
        return { message: "зрозумів", readyForConfirmation: true };
      },
    }),
  });
  await chat.load();
  chat.input.value = "мій досвід";
  await chat.send();
  assert.equal(chat.messages.value.length, 3);
  assert.equal(chat.messages.value[1]?.authorType, "HUMAN_HR");
  assert.equal(chat.messages.value[2]?.content, "зрозумів");
  assert.equal(chat.lastReadyForConfirmation.value, true);
  assert.equal(chat.input.value, "");
});

test("retry after failed greeting calls sendMessage without text", async () => {
  let calls = 0;
  const chat = usePrepChat({
    adapters: makeAdapters({
      sendMessage: async (text) => {
        calls += 1;
        if (calls === 1) throw new Error("LLM down");
        assert.equal(text, undefined);
        return { message: "ok", readyForConfirmation: false };
      },
    }),
  });
  await chat.load();
  assert.equal(chat.lastFailedAction.value, "greeting");
  await chat.retry();
  assert.equal(chat.lastFailedAction.value, null);
  assert.equal(chat.messages.value.at(-1)?.content, "ok");
});

test("retry after failed finish calls finishChat again", async () => {
  let finishes = 0;
  const chat = usePrepChat({
    adapters: makeAdapters({
      loadState: async () => ({
        messages: [
          {
            id: "1",
            authorType: "AGENT_COMPANY",
            content: "hi",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        isClosed: false,
        profile: null,
      }),
      finishChat: async () => {
        finishes += 1;
        if (finishes === 1) throw new Error("finish fail");
        return { profile: { confirmedAt: null } };
      },
    }),
  });
  await chat.load();
  chat.lastReadyForConfirmation.value = true;
  await chat.finish();
  assert.equal(chat.lastFailedAction.value, "finish");
  await chat.retry();
  assert.equal(chat.isClosed.value, true);
  assert.equal(chat.profile.value?.confirmedAt, null);
  assert.equal(chat.lastFailedAction.value, null);
});

test("delete resets and greets again when confirm true", async () => {
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    let deleted = false;
    let greetings = 0;
    const chat = usePrepChat({
      adapters: makeAdapters({
        loadState: async () => ({
          messages: [
            {
              id: "1",
              authorType: "AGENT_COMPANY",
              content: "hi",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          isClosed: false,
          profile: null,
        }),
        deleteChat: async () => {
          deleted = true;
        },
        sendMessage: async () => {
          greetings += 1;
          return { message: "again", readyForConfirmation: false };
        },
      }),
    });
    await chat.load();
    await chat.deleteChat();
    assert.equal(deleted, true);
    assert.equal(greetings, 1);
    assert.equal(chat.messages.value[0]?.content, "again");
  } finally {
    globalThis.confirm = originalConfirm;
  }
});
