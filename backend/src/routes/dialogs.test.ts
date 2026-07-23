import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createDialogsRouter } from "./dialogs";

type FakeUser = { id: string; email: string; role: string };

type FakeDialog = {
  id: string;
  hrUserId: string;
  candidateUserId: string;
  createdAt: Date;
  updatedAt: Date;
  hrLastReadAt: Date | null;
  candidateLastReadAt: Date | null;
  hrHiddenAt: Date | null;
  candidateHiddenAt: Date | null;
};

type FakeDialogMessage = {
  id: string;
  dialogId: string;
  senderUserId: string;
  body: string;
  kind: string;
  decisionId: string | null;
  createdAt: Date;
};

type FakeDecision = {
  id: string;
  type: string;
};

type FakeInterview = {
  id: string;
  hrUserId: string;
  candidateUserId: string | null;
};

type FakeVacancy = {
  id: string;
  hrUserId: string;
};

type FakeApplication = {
  id: string;
  candidateUserId: string;
  vacancyId: string;
};

type FakePrismaSeed = {
  users?: FakeUser[];
  dialogs?: FakeDialog[];
  messages?: FakeDialogMessage[];
  decisions?: FakeDecision[];
  interviews?: FakeInterview[];
  vacancies?: FakeVacancy[];
  applications?: FakeApplication[];
};

function makeFakePrisma(seed: FakePrismaSeed = {}) {
  const users = [...(seed.users ?? [])];
  const dialogs = [...(seed.dialogs ?? [])];
  const messages = [...(seed.messages ?? [])];
  const decisions = [...(seed.decisions ?? [])];
  const interviews = [...(seed.interviews ?? [])];
  const vacancies = [...(seed.vacancies ?? [])];
  const applications = [...(seed.applications ?? [])];
  let dialogSeq = dialogs.length;
  let messageSeq = messages.length;

  const prisma = {
    dialog: {
      findMany: async ({
        where,
        orderBy,
        include,
        select,
      }: {
        where?: {
          hrUserId?: string;
          candidateUserId?: string;
          hrHiddenAt?: null;
          candidateHiddenAt?: null;
        };
        orderBy?: { updatedAt: "desc" | "asc" };
        include?: {
          hrUser?: { select: { id: true; email: true } };
          candidateUser?: { select: { id: true; email: true } };
          messages?: {
            orderBy: { createdAt: "desc" | "asc" };
            take: number;
            select: { body: true; createdAt: true; kind: true };
          };
        };
        select?: {
          id?: true;
          hrUserId?: true;
          hrLastReadAt?: true;
          candidateLastReadAt?: true;
        };
      }) => {
        let rows = dialogs.filter((d) => {
          if (where?.hrUserId != null && d.hrUserId !== where.hrUserId) return false;
          if (where?.candidateUserId != null && d.candidateUserId !== where.candidateUserId) {
            return false;
          }
          if (where?.hrHiddenAt === null && d.hrHiddenAt != null) return false;
          if (where?.candidateHiddenAt === null && d.candidateHiddenAt != null) return false;
          return true;
        });
        if (orderBy?.updatedAt === "desc") {
          rows = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        }
        if (select) {
          return rows.map((d) => ({
            ...(select.id ? { id: d.id } : {}),
            ...(select.hrUserId ? { hrUserId: d.hrUserId } : {}),
            ...(select.hrLastReadAt ? { hrLastReadAt: d.hrLastReadAt } : {}),
            ...(select.candidateLastReadAt
              ? { candidateLastReadAt: d.candidateLastReadAt }
              : {}),
          }));
        }
        return rows.map((d) => {
          const hrUser = users.find((u) => u.id === d.hrUserId);
          const candidateUser = users.find((u) => u.id === d.candidateUserId);
          let lastMessages: Array<{ body: string; createdAt: Date; kind: string }> = [];
          if (include?.messages) {
            lastMessages = messages
              .filter((m) => m.dialogId === d.id)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(0, include.messages.take)
              .map((m) => ({ body: m.body, createdAt: m.createdAt, kind: m.kind }));
          }
          return {
            ...d,
            ...(include?.hrUser
              ? { hrUser: hrUser ? { id: hrUser.id, email: hrUser.email } : null }
              : {}),
            ...(include?.candidateUser
              ? {
                  candidateUser: candidateUser
                    ? { id: candidateUser.id, email: candidateUser.email }
                    : null,
                }
              : {}),
            ...(include?.messages ? { messages: lastMessages } : {}),
          };
        });
      },
      findUnique: async ({
        where,
        include,
      }: {
        where: {
          id?: string;
          hrUserId_candidateUserId?: { hrUserId: string; candidateUserId: string };
        };
        include?: {
          messages?: {
            orderBy: { createdAt: "asc" | "desc" };
            include?: { decision?: { select: { type: true } } };
          };
        };
      }) => {
        let dialog: FakeDialog | undefined;
        if (where.id) {
          dialog = dialogs.find((d) => d.id === where.id);
        } else if (where.hrUserId_candidateUserId) {
          const key = where.hrUserId_candidateUserId;
          dialog = dialogs.find(
            (d) =>
              d.hrUserId === key.hrUserId && d.candidateUserId === key.candidateUserId,
          );
        }
        if (!dialog) return null;

        let threadMessages:
          | Array<
              FakeDialogMessage & {
                decision?: { type: string } | null;
              }
            >
          | undefined;
        if (include?.messages) {
          threadMessages = messages
            .filter((m) => m.dialogId === dialog!.id)
            .sort((a, b) =>
              include.messages!.orderBy.createdAt === "asc"
                ? a.createdAt.getTime() - b.createdAt.getTime()
                : b.createdAt.getTime() - a.createdAt.getTime(),
            )
            .map((m) => {
              const decision = m.decisionId
                ? decisions.find((d) => d.id === m.decisionId)
                : null;
              return {
                ...m,
                ...(include.messages!.include?.decision
                  ? { decision: decision ? { type: decision.type } : null }
                  : {}),
              };
            });
        }

        return {
          ...dialog,
          ...(threadMessages ? { messages: threadMessages } : {}),
        };
      },
      create: async ({
        data,
      }: {
        data: { hrUserId: string; candidateUserId: string };
      }) => {
        dialogSeq += 1;
        const now = new Date();
        const created: FakeDialog = {
          id: `dlg_${dialogSeq}`,
          hrUserId: data.hrUserId,
          candidateUserId: data.candidateUserId,
          createdAt: now,
          updatedAt: now,
          hrLastReadAt: null,
          candidateLastReadAt: null,
          hrHiddenAt: null,
          candidateHiddenAt: null,
        };
        dialogs.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: {
          updatedAt?: Date;
          hrLastReadAt?: Date | null;
          candidateLastReadAt?: Date | null;
          hrHiddenAt?: Date | null;
          candidateHiddenAt?: Date | null;
        };
      }) => {
        const dialog = dialogs.find((d) => d.id === where.id);
        if (!dialog) throw new Error("Dialog not found");
        if (data.updatedAt) dialog.updatedAt = data.updatedAt;
        if (data.hrLastReadAt !== undefined) dialog.hrLastReadAt = data.hrLastReadAt;
        if (data.candidateLastReadAt !== undefined) {
          dialog.candidateLastReadAt = data.candidateLastReadAt;
        }
        if (data.hrHiddenAt !== undefined) dialog.hrHiddenAt = data.hrHiddenAt;
        if (data.candidateHiddenAt !== undefined) {
          dialog.candidateHiddenAt = data.candidateHiddenAt;
        }
        return dialog;
      },
    },
    dialogMessage: {
      create: async ({
        data,
      }: {
        data: {
          dialogId: string;
          senderUserId: string;
          body: string;
          kind: string;
          decisionId?: string | null;
        };
      }) => {
        messageSeq += 1;
        const created: FakeDialogMessage = {
          id: `msg_${messageSeq}`,
          dialogId: data.dialogId,
          senderUserId: data.senderUserId,
          body: data.body,
          kind: data.kind,
          decisionId: data.decisionId ?? null,
          createdAt: new Date(),
        };
        messages.push(created);
        return created;
      },
      count: async ({
        where,
      }: {
        where: {
          dialogId: string;
          senderUserId?: { not: string };
          createdAt?: { gt: Date };
        };
      }) => {
        return messages.filter((m) => {
          if (m.dialogId !== where.dialogId) return false;
          if (
            where.senderUserId?.not != null &&
            m.senderUserId === where.senderUserId.not
          ) {
            return false;
          }
          if (where.createdAt?.gt != null && !(m.createdAt > where.createdAt.gt)) {
            return false;
          }
          return true;
        }).length;
      },
    },
    interview: {
      findFirst: async ({
        where,
        select,
      }: {
        where: { hrUserId: string; candidateUserId: string };
        select?: { id: true };
      }) => {
        const found = interviews.find(
          (i) =>
            i.hrUserId === where.hrUserId && i.candidateUserId === where.candidateUserId,
        );
        if (!found) return null;
        return select ? { id: found.id } : found;
      },
    },
    vacancyApplication: {
      findFirst: async ({
        where,
        select,
      }: {
        where: {
          candidateUserId: string;
          vacancy?: { hrUserId: string };
        };
        select?: { id: true };
      }) => {
        const found = applications.find((app) => {
          if (app.candidateUserId !== where.candidateUserId) return false;
          if (where.vacancy?.hrUserId != null) {
            const vacancy = vacancies.find((v) => v.id === app.vacancyId);
            if (!vacancy || vacancy.hrUserId !== where.vacancy.hrUserId) return false;
          }
          return true;
        });
        if (!found) return null;
        return select ? { id: found.id } : found;
      },
    },
    __dialogs: dialogs,
    __messages: messages,
  };

  return prisma;
}

function withUser(user: AuthUser | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user?: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createDialogsRouter(() => fakePrisma as never));
  return app;
}

const hrUser: AuthUser = { id: "hr_1", email: "hr@test.com", role: "HR" };
const candidateUser: AuthUser = {
  id: "cand_1",
  email: "cand@test.com",
  role: "CANDIDATE",
};
const otherHr: AuthUser = { id: "hr_2", email: "hr2@test.com", role: "HR" };
const otherCandidate: AuthUser = {
  id: "cand_2",
  email: "cand2@test.com",
  role: "CANDIDATE",
};

const users: FakeUser[] = [
  { id: "hr_1", email: "hr@test.com", role: "HR" },
  { id: "hr_2", email: "hr2@test.com", role: "HR" },
  { id: "cand_1", email: "cand@test.com", role: "CANDIDATE" },
  { id: "cand_2", email: "cand2@test.com", role: "CANDIDATE" },
];

const baseDialog: FakeDialog = {
  id: "dlg_1",
  hrUserId: "hr_1",
  candidateUserId: "cand_1",
  createdAt: new Date("2026-07-14T10:00:00.000Z"),
  updatedAt: new Date("2026-07-14T12:00:00.000Z"),
  hrLastReadAt: null,
  candidateLastReadAt: null,
  hrHiddenAt: null,
  candidateHiddenAt: null,
};

const otherDialog: FakeDialog = {
  id: "dlg_2",
  hrUserId: "hr_2",
  candidateUserId: "cand_2",
  createdAt: new Date("2026-07-14T11:00:00.000Z"),
  updatedAt: new Date("2026-07-14T13:00:00.000Z"),
  hrLastReadAt: null,
  candidateLastReadAt: null,
  hrHiddenAt: null,
  candidateHiddenAt: null,
};

test("GET /dialogs lists only own dialogs for HR", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [baseDialog, otherDialog],
    messages: [
      {
        id: "msg_1",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "Hello from candidate",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:30:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dialogs.length, 1);
    assert.equal(body.dialogs[0].id, "dlg_1");
    assert.deepEqual(body.dialogs[0].peer, { id: "cand_1", email: "cand@test.com" });
    assert.equal(body.dialogs[0].lastMessage.kind, "USER");
    assert.equal(body.dialogs[0].lastMessage.body, "Hello from candidate");
    assert.equal(body.dialogs[0].updatedAt, "2026-07-14T12:00:00.000Z");
  } finally {
    server.close();
  }
});

test("GET /dialogs lists only own dialogs for candidate", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [baseDialog, otherDialog],
  });
  const app = makeApp(prisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dialogs.length, 1);
    assert.equal(body.dialogs[0].id, "dlg_1");
    assert.deepEqual(body.dialogs[0].peer, { id: "hr_1", email: "hr@test.com" });
    assert.equal(body.dialogs[0].lastMessage, null);
  } finally {
    server.close();
  }
});

test("GET /dialogs includes unreadCount for foreign messages only", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [baseDialog],
    messages: [
      {
        id: "msg_own",
        dialogId: "dlg_1",
        senderUserId: "hr_1",
        body: "from hr",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:00:00.000Z"),
      },
      {
        id: "msg_1",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "hi",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:30:00.000Z"),
      },
      {
        id: "msg_2",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "again",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:45:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      dialogs: Array<{ id: string; unreadCount: number }>;
    };
    assert.equal(body.dialogs[0]?.unreadCount, 2);
  } finally {
    server.close();
  }
});

test("GET /dialogs unreadCount respects hrLastReadAt cursor", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      {
        ...baseDialog,
        hrLastReadAt: new Date("2026-07-14T11:40:00.000Z"),
      },
    ],
    messages: [
      {
        id: "msg_old",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "old",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:30:00.000Z"),
      },
      {
        id: "msg_new",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "new",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:50:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    const body = (await response.json()) as {
      dialogs: Array<{ unreadCount: number }>;
    };
    assert.equal(body.dialogs[0]?.unreadCount, 1);
  } finally {
    server.close();
  }
});

test("POST /dialogs creates for eligible interview candidate, second call returns same id", async () => {
  const prisma = makeFakePrisma({
    users,
    interviews: [{ id: "int_1", hrUserId: "hr_1", candidateUserId: "cand_1" }],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const createRes = await fetch(`http://127.0.0.1:${port}/api/dialogs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cand_1" }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.dialog.hrUserId, "hr_1");
    assert.equal(created.dialog.candidateUserId, "cand_1");
    assert.ok(created.dialog.id);

    const againRes = await fetch(`http://127.0.0.1:${port}/api/dialogs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cand_1" }),
    });
    assert.equal(againRes.status, 200);
    const again = await againRes.json();
    assert.equal(again.dialog.id, created.dialog.id);
    assert.equal(prisma.__dialogs.length, 1);
  } finally {
    server.close();
  }
});

test("POST /dialogs accepts candidate with VacancyApplication on HR vacancy", async () => {
  const prisma = makeFakePrisma({
    users,
    vacancies: [{ id: "vac_1", hrUserId: "hr_1" }],
    applications: [{ id: "app_1", candidateUserId: "cand_1", vacancyId: "vac_1" }],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cand_1" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.dialog.candidateUserId, "cand_1");
  } finally {
    server.close();
  }
});

test("POST /dialogs rejects unrelated candidate", async () => {
  const prisma = makeFakePrisma({ users });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cand_2" }),
    });
    assert.ok(response.status === 400 || response.status === 403);
    const body = await response.json();
    assert.equal(body.error, "Candidate not eligible");
  } finally {
    server.close();
  }
});

test("POST /dialogs returns 403 for candidate", async () => {
  const prisma = makeFakePrisma({
    users,
    interviews: [{ id: "int_1", hrUserId: "hr_1", candidateUserId: "cand_1" }],
  });
  const app = makeApp(prisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: "cand_1" }),
    });
    assert.equal(response.status, 403);
  } finally {
    server.close();
  }
});

test("participant can GET thread with decision.type and POST USER message", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [baseDialog],
    decisions: [{ id: "dec_1", type: "ACCEPT" }],
    messages: [
      {
        id: "msg_letter",
        dialogId: "dlg_1",
        senderUserId: "hr_1",
        body: "Congratulations",
        kind: "DECISION_LETTER",
        decisionId: "dec_1",
        createdAt: new Date("2026-07-14T11:00:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const getRes = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1`);
    assert.equal(getRes.status, 200);
    const thread = await getRes.json();
    assert.equal(thread.dialog.id, "dlg_1");
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0].kind, "DECISION_LETTER");
    assert.deepEqual(thread.messages[0].decision, { type: "ACCEPT" });

    const postRes = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "  Thank you!  " }),
    });
    assert.equal(postRes.status, 201);
    const posted = await postRes.json();
    assert.equal(posted.message.kind, "USER");
    assert.equal(posted.message.body, "Thank you!");
    assert.equal(posted.message.senderUserId, "cand_1");
    assert.equal(prisma.__messages.length, 2);
  } finally {
    server.close();
  }
});

test("non-participant GET and POST return 404", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [baseDialog],
  });
  const app = makeApp(prisma, otherHr);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const getRes = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1`);
    assert.equal(getRes.status, 404);

    const postRes = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Hi" }),
    });
    assert.equal(postRes.status, 404);
  } finally {
    server.close();
  }
});

test("POST /dialogs/:id/messages rejects empty body", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [baseDialog],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "   " }),
    });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test("GET /dialogs/unread-count sums unread across dialogs", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      baseDialog,
      {
        id: "dlg_3",
        hrUserId: "hr_1",
        candidateUserId: "cand_2",
        createdAt: new Date("2026-07-14T10:00:00.000Z"),
        updatedAt: new Date("2026-07-14T12:00:00.000Z"),
        hrLastReadAt: null,
        candidateLastReadAt: null,
        hrHiddenAt: null,
        candidateHiddenAt: null,
      },
    ],
    messages: [
      {
        id: "m1",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "a",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:00:00.000Z"),
      },
      {
        id: "m2",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "b",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:10:00.000Z"),
      },
      {
        id: "m3",
        dialogId: "dlg_3",
        senderUserId: "cand_2",
        body: "c",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:20:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs/unread-count`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { unreadCount: number };
    assert.equal(body.unreadCount, 3);
  } finally {
    server.close();
  }
});

test("POST /dialogs/:id/read clears unread for participant", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [baseDialog],
    messages: [
      {
        id: "m1",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "a",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:00:00.000Z"),
      },
      {
        id: "m2",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "b",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:10:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const readRes = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1/read`, {
      method: "POST",
    });
    assert.equal(readRes.status, 200);
    const readBody = (await readRes.json()) as { ok: boolean };
    assert.equal(readBody.ok, true);

    const listRes = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    const listBody = (await listRes.json()) as {
      dialogs: Array<{ unreadCount: number }>;
    };
    assert.equal(listBody.dialogs[0]?.unreadCount, 0);
  } finally {
    server.close();
  }
});

test("POST /dialogs/:id/read returns 404 for non-participant", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [baseDialog],
  });
  const app = makeApp(prisma, otherHr);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1/read`, {
      method: "POST",
    });
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test("GET /dialogs/unread-count for candidate uses candidateLastReadAt", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      {
        ...baseDialog,
        candidateLastReadAt: new Date("2026-07-14T11:40:00.000Z"),
      },
    ],
    messages: [
      {
        id: "letter",
        dialogId: "dlg_1",
        senderUserId: "hr_1",
        body: "decision",
        kind: "DECISION_LETTER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:30:00.000Z"),
      },
      {
        id: "newer",
        dialogId: "dlg_1",
        senderUserId: "hr_1",
        body: "follow-up",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:50:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const before = await fetch(`http://127.0.0.1:${port}/api/dialogs/unread-count`);
    const beforeBody = (await before.json()) as { unreadCount: number };
    assert.equal(beforeBody.unreadCount, 1);

    await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1/read`, { method: "POST" });

    const after = await fetch(`http://127.0.0.1:${port}/api/dialogs/unread-count`);
    const afterBody = (await after.json()) as { unreadCount: number };
    assert.equal(afterBody.unreadCount, 0);
  } finally {
    server.close();
  }
});

test("DELETE /dialogs/:id hides dialog for HR only; candidate still lists it", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [{ ...baseDialog }],
    messages: [
      {
        id: "msg_1",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "Hi",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:30:00.000Z"),
      },
    ],
  });

  const hrApp = makeApp(prisma, hrUser);
  const hrServer = hrApp.listen(0);
  const hrPort = (hrServer.address() as { port: number }).port;

  try {
    const del = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs/dlg_1`, {
      method: "DELETE",
    });
    assert.equal(del.status, 204);

    const hrList = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs`);
    assert.equal(hrList.status, 200);
    assert.equal((await hrList.json()).dialogs.length, 0);

    const hrUnread = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs/unread-count`);
    assert.equal(hrUnread.status, 200);
    assert.equal((await hrUnread.json()).unreadCount, 0);
  } finally {
    hrServer.close();
  }

  const candApp = makeApp(prisma, candidateUser);
  const candServer = candApp.listen(0);
  const candPort = (candServer.address() as { port: number }).port;

  try {
    const candList = await fetch(`http://127.0.0.1:${candPort}/api/dialogs`);
    assert.equal(candList.status, 200);
    assert.equal((await candList.json()).dialogs.length, 1);

    const thread = await fetch(`http://127.0.0.1:${candPort}/api/dialogs/dlg_1`);
    assert.equal(thread.status, 200);
    assert.equal((await thread.json()).messages.length, 1);
  } finally {
    candServer.close();
  }
});

test("DELETE /dialogs/:id hides dialog for candidate only", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [{ ...baseDialog }],
  });
  const app = makeApp(prisma, candidateUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const del = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1`, {
      method: "DELETE",
    });
    assert.equal(del.status, 204);

    const list = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    assert.equal((await list.json()).dialogs.length, 0);
  } finally {
    server.close();
  }

  const hrApp = makeApp(prisma, hrUser);
  const hrServer = hrApp.listen(0);
  const hrPort = (hrServer.address() as { port: number }).port;
  try {
    const list = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs`);
    assert.equal((await list.json()).dialogs.length, 1);
  } finally {
    hrServer.close();
  }
});

test("DELETE /dialogs/:id returns 404 for non-participant", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [{ ...baseDialog }],
  });
  const app = makeApp(prisma, otherHr);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1`, {
      method: "DELETE",
    });
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test("GET /dialogs/:id still works after hide for hider", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      {
        ...baseDialog,
        hrHiddenAt: new Date("2026-07-20T10:00:00.000Z"),
        candidateHiddenAt: null,
      },
    ],
    messages: [
      {
        id: "msg_1",
        dialogId: "dlg_1",
        senderUserId: "cand_1",
        body: "Still here",
        kind: "USER",
        decisionId: null,
        createdAt: new Date("2026-07-14T11:30:00.000Z"),
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.messages[0].body, "Still here");
  } finally {
    server.close();
  }
});

test("candidate message after HR hide clears hrHiddenAt and restores HR list", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      {
        ...baseDialog,
        hrHiddenAt: new Date("2026-07-20T10:00:00.000Z"),
        candidateHiddenAt: null,
      },
    ],
  });

  const candApp = makeApp(prisma, candidateUser);
  const candServer = candApp.listen(0);
  const candPort = (candServer.address() as { port: number }).port;

  try {
    const send = await fetch(`http://127.0.0.1:${candPort}/api/dialogs/dlg_1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Ping" }),
    });
    assert.equal(send.status, 201);
  } finally {
    candServer.close();
  }

  const hrApp = makeApp(prisma, hrUser);
  const hrServer = hrApp.listen(0);
  const hrPort = (hrServer.address() as { port: number }).port;

  try {
    const list = await fetch(`http://127.0.0.1:${hrPort}/api/dialogs`);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).dialogs.length, 1);
  } finally {
    hrServer.close();
  }
});

test("own message after hide does not clear own hiddenAt", async () => {
  const prisma = makeFakePrisma({
    users,
    dialogs: [
      {
        ...baseDialog,
        hrHiddenAt: new Date("2026-07-20T10:00:00.000Z"),
        candidateHiddenAt: null,
      },
    ],
  });
  const app = makeApp(prisma, hrUser);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const send = await fetch(`http://127.0.0.1:${port}/api/dialogs/dlg_1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Still hidden for me" }),
    });
    assert.equal(send.status, 201);

    const list = await fetch(`http://127.0.0.1:${port}/api/dialogs`);
    assert.equal((await list.json()).dialogs.length, 0);
  } finally {
    server.close();
  }
});
