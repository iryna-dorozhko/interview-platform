import test from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AuthUser } from "../auth/middleware";
import { createVacanciesRouter } from "./vacancies";

type FakeCompanyProfile = {
  vacancyId: string;
  role: string;
  requirements: unknown;
  culture: string[];
  expectations: string[];
  confirmedAt: Date | null;
};

type FakeVacancy = {
  id: string;
  hrUserId: string;
  title: string;
  status: string;
  createdAt: Date;
  hiddenAt?: Date | null;
  _interviewCount?: number;
  _interviewStatuses?: string[];
  companyProfile?: FakeCompanyProfile | null;
};

function makeFakePrisma(vacancies: FakeVacancy[] = []) {
  let counter = 0;
  const interviews: { vacancyId: string; status: string }[] = vacancies.flatMap((v) => {
    if (v._interviewStatuses?.length) {
      return v._interviewStatuses.map((status) => ({ vacancyId: v.id, status }));
    }
    return Array.from({ length: v._interviewCount ?? 0 }, () => ({
      vacancyId: v.id,
      status: "ENDED",
    }));
  });

  return {
    vacancy: {
      findMany: async ({
        where,
      }: {
        where: {
          hrUserId: string;
          hiddenAt?: null | { not: null };
        };
      }) =>
        vacancies
          .filter((v) => {
            if (v.hrUserId !== where.hrUserId) return false;
            const hiddenAt = v.hiddenAt ?? null;
            if (where.hiddenAt === null) return hiddenAt === null;
            if (where.hiddenAt && "not" in where.hiddenAt && where.hiddenAt.not === null) {
              return hiddenAt !== null;
            }
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { companyProfile?: boolean };
      }) => {
        const vacancy = vacancies.find((v) => v.id === where.id);
        if (!vacancy) return null;
        const withDefaults = { ...vacancy, hiddenAt: vacancy.hiddenAt ?? null };
        if (include?.companyProfile) {
          return { ...withDefaults, companyProfile: vacancy.companyProfile ?? null };
        }
        return withDefaults;
      },
      create: async ({ data }: { data: { hrUserId: string; title: string; status: string } }) => {
        counter += 1;
        const created: FakeVacancy = {
          id: `vac_${counter}`,
          hrUserId: data.hrUserId,
          title: data.title,
          status: data.status,
          createdAt: new Date(),
          hiddenAt: null,
        };
        vacancies.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Pick<FakeVacancy, "title" | "status" | "hiddenAt">>;
      }) => {
        const vacancy = vacancies.find((v) => v.id === where.id);
        if (!vacancy) throw new Error("not found");
        Object.assign(vacancy, data);
        return { ...vacancy, hiddenAt: vacancy.hiddenAt ?? null };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = vacancies.findIndex((v) => v.id === where.id);
        if (index === -1) throw new Error("not found");
        return vacancies.splice(index, 1)[0];
      },
    },
    interview: {
      count: async ({ where }: { where: { vacancyId: string } }) =>
        interviews.filter((i) => i.vacancyId === where.vacancyId).length,
      findFirst: async ({
        where,
      }: {
        where: { vacancyId: string; status?: { in: string[] } };
      }) => {
        const allowed = where.status?.in;
        return (
          interviews.find(
            (item) =>
              item.vacancyId === where.vacancyId &&
              (allowed == null || allowed.includes(item.status)),
          ) ?? null
        );
      },
    },
    companyProfile: {
      updateMany: async () => ({ count: 1 }),
    },
  };
}

function withUser(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

function makeApp(fakePrisma: ReturnType<typeof makeFakePrisma>, user: AuthUser) {
  const app = express();
  app.use(express.json());
  app.use(withUser(user));
  app.use("/api", createVacanciesRouter(() => fakePrisma as never));
  return app;
}

async function withServer(
  app: ReturnType<typeof makeApp>,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

test("POST /vacancies creates DRAFT vacancy with title", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Frontend Developer" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.vacancy.title, "Frontend Developer");
    assert.equal(body.vacancy.status, "DRAFT");
    assert.equal(body.vacancy.hiddenAt, null);
  });
});

test("DELETE /vacancies/:id returns 409 when interviews exist", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      createdAt: new Date(),
      _interviewCount: 1,
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1`, { method: "DELETE" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.interviewCount, 1);
  });
});

test("GET /vacancies/:id normalizes legacy string[] requirements", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "DRAFT",
      createdAt: new Date(),
      companyProfile: {
        vacancyId: "v1",
        role: "Backend",
        requirements: ["Node.js", "TypeScript"],
        culture: [],
        expectations: [],
        confirmedAt: null,
      },
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.vacancy.profile.requirements, {
      critical: [],
      desired: ["Node.js", "TypeScript"],
    });
    assert.equal(body.vacancy.hiddenAt, null);
  });
});

test("PATCH /vacancies/:id on CONFIRMED updates title and keeps CONFIRMED", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "v1", hrUserId: "hr_1", title: "Dev", status: "CONFIRMED", createdAt: new Date() },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Senior Dev" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.vacancy.status, "CONFIRMED");
    assert.equal(body.vacancy.title, "Senior Dev");
  });
});

test("GET /vacancies/mine?visibility=hidden returns only hidden", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Visible",
      status: "CONFIRMED",
      createdAt: new Date("2026-01-02"),
      hiddenAt: null,
    },
    {
      id: "v2",
      hrUserId: "hr_1",
      title: "Hidden",
      status: "CONFIRMED",
      createdAt: new Date("2026-01-01"),
      hiddenAt: new Date("2026-01-03"),
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const active = await fetch(`http://127.0.0.1:${port}/api/vacancies/mine`);
    assert.equal(active.status, 200);
    const activeBody = await active.json();
    assert.equal(activeBody.vacancies.length, 1);
    assert.equal(activeBody.vacancies[0].id, "v1");
    assert.equal(activeBody.vacancies[0].hiddenAt, null);

    const hidden = await fetch(`http://127.0.0.1:${port}/api/vacancies/mine?visibility=hidden`);
    assert.equal(hidden.status, 200);
    const hiddenBody = await hidden.json();
    assert.equal(hiddenBody.vacancies.length, 1);
    assert.equal(hiddenBody.vacancies[0].id, "v2");
    assert.ok(typeof hiddenBody.vacancies[0].hiddenAt === "string");
  });
});

test("POST /vacancies/:id/hide succeeds when only ENDED interviews", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      createdAt: new Date(),
      hiddenAt: null,
      _interviewStatuses: ["ENDED"],
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1/hide`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.vacancy.hiddenAt);
  });
});

test("POST /vacancies/:id/hide returns 409 ACTIVE_INTERVIEWS_EXIST for LIVE", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      createdAt: new Date(),
      hiddenAt: null,
      _interviewStatuses: ["LIVE"],
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1/hide`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "ACTIVE_INTERVIEWS_EXIST");
  });
});

test("POST /vacancies/:id/hide returns 409 for AWAITING_CANDIDATE", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      createdAt: new Date(),
      hiddenAt: null,
      _interviewStatuses: ["AWAITING_CANDIDATE"],
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1/hide`, {
      method: "POST",
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, "ACTIVE_INTERVIEWS_EXIST");
  });
});

test("POST /vacancies/:id/unhide clears hiddenAt", async () => {
  const fakePrisma = makeFakePrisma([
    {
      id: "v1",
      hrUserId: "hr_1",
      title: "Dev",
      status: "CONFIRMED",
      createdAt: new Date(),
      hiddenAt: new Date(),
    },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });

  await withServer(app, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1/unhide`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.vacancy.hiddenAt, null);
  });
});
