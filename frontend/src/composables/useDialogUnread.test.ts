import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatUnreadBadge,
  createDialogUnreadController,
} from "./useDialogUnread";

test("formatUnreadBadge shows 99+ above 99", () => {
  assert.equal(formatUnreadBadge(0), "0");
  assert.equal(formatUnreadBadge(3), "3");
  assert.equal(formatUnreadBadge(99), "99");
  assert.equal(formatUnreadBadge(100), "99+");
});

test("refresh loads unread total", async () => {
  const controller = createDialogUnreadController({
    fetchUnreadCount: async () => 4,
    markDialogRead: async () => undefined,
  });
  await controller.refresh();
  assert.equal(controller.unreadCount.value, 4);
});

test("refresh swallows errors", async () => {
  const controller = createDialogUnreadController({
    fetchUnreadCount: async () => {
      throw new Error("network");
    },
    markDialogRead: async () => undefined,
  });
  controller.unreadCount.value = 2;
  await controller.refresh();
  assert.equal(controller.unreadCount.value, 2);
});

test("markRead calls API then refreshes", async () => {
  const calls: string[] = [];
  const controller = createDialogUnreadController({
    fetchUnreadCount: async () => {
      calls.push("fetch");
      return 0;
    },
    markDialogRead: async (id: string) => {
      calls.push(`mark:${id}`);
    },
  });
  await controller.markRead("dlg_1");
  assert.deepEqual(calls, ["mark:dlg_1", "fetch"]);
  assert.equal(controller.unreadCount.value, 0);
});
