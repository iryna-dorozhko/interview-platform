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
  _interviewCount?: number;
  companyProfile?: FakeCompanyProfile | null;
};

function makeFakePrisma(vacancies: FakeVacancy[] = []) {
  let counter = 0;
  const interviews: { vacancyId: string }[] = vacancies.flatMap((v) =>
    Array.from({ length: v._interviewCount ?? 0 }, () => ({ vacancyId: v.id }))
  );

  return {
    vacancy: {
      findMany: async ({ where }: { where: { hrUserId: string } }) =>
        vacancies
          .filter((v) => v.hrUserId === where.hrUserId)
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
        if (include?.companyProfile) {
          return { ...vacancy, companyProfile: vacancy.companyProfile ?? null };
        }
        return vacancy;
      },
      create: async ({ data }: { data: { hrUserId: string; title: string; status: string } }) => {
        counter += 1;
        const created: FakeVacancy = {
          id: `vac_${counter}`,
          hrUserId: data.hrUserId,
          title: data.title,
          status: data.status,
          createdAt: new Date(),
        };
        vacancies.push(created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Pick<FakeVacancy, "title" | "status">>;
      }) => {
        const vacancy = vacancies.find((v) => v.id === where.id);
        if (!vacancy) throw new Error("not found");
        Object.assign(vacancy, data);
        return vacancy;
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

test("POST /vacancies creates DRAFT vacancy with title", async () => {
  const fakePrisma = makeFakePrisma([]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Frontend Developer" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.vacancy.title, "Frontend Developer");
    assert.equal(body.vacancy.status, "DRAFT");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("DELETE /vacancies/:id returns 409 when interviews exist", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "v1", hrUserId: "hr_1", title: "Dev", status: "CONFIRMED", createdAt: new Date(), _interviewCount: 1 },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1`, { method: "DELETE" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.interviewCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
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
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.vacancy.profile.requirements, {
      critical: [],
      desired: ["Node.js", "TypeScript"],
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("PATCH /vacancies/:id on CONFIRMED resets status to DRAFT", async () => {
  const fakePrisma = makeFakePrisma([
    { id: "v1", hrUserId: "hr_1", title: "Dev", status: "CONFIRMED", createdAt: new Date() },
  ]);
  const app = makeApp(fakePrisma, { id: "hr_1", email: "hr@test.com", role: "HR" });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vacancies/v1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Senior Dev" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.vacancy.status, "DRAFT");
    assert.equal(body.vacancy.title, "Senior Dev");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
