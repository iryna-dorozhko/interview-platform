import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAuthRouter } from "./auth";
import { hashPassword } from "../auth/password";

const ORIGINAL_SECRET = process.env.JWT_SECRET;
test.before(() => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
});
test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
});

function makeFakePrisma(user: {
  id: string;
  email: string;
  passwordHash: string;
  role: "HR" | "CANDIDATE";
} | null) {
  return {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        if (!user || user.email !== where.email) return null;
        return user;
      },
      create: async ({
        data,
      }: {
        data: {
          email: string;
          passwordHash: string;
          role: "HR" | "CANDIDATE";
        };
      }) => ({
        id: "created_candidate",
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
      }),
    },
  };
}

test("POST /auth/hr/login returns token for valid HR credentials", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/hr/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.deepEqual(body.user, {
      id: "user_hr",
      email: "hr@test.com",
      role: "HR",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/hr/login returns 401 for wrong password", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/hr/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hr@test.com", password: "wrong" }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Invalid credentials");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/hr/login is case-insensitive for email", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/hr/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "  HR@Test.COM  ", password: "123456" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.equal(body.user.email, "hr@test.com");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/hr/login returns 403 for CANDIDATE role", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_cd",
        email: "candidate@test.com",
        passwordHash,
        role: "CANDIDATE",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/hr/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "candidate@test.com", password: "123456" }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "HR access only");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/candidate/register creates candidate user", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash: hashPassword("123456"),
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/candidate/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newcandidate@test.com", password: "123456" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.token);
    assert.deepEqual(body.user, {
      id: "created_candidate",
      email: "newcandidate@test.com",
      role: "CANDIDATE",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/candidate/login returns 403 for HR account", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/candidate/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Candidate access only");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/candidate/login returns token for candidate", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_cd",
        email: "candidate@test.com",
        passwordHash,
        role: "CANDIDATE",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/candidate/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "candidate@test.com", password: "123456" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.deepEqual(body.user, {
      id: "user_cd",
      email: "candidate@test.com",
      role: "CANDIDATE",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/candidate/login is case-insensitive for email", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_cd",
        email: "candidate@test.com",
        passwordHash,
        role: "CANDIDATE",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/candidate/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "CANDIDATE@Test.com", password: "123456" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.equal(body.user.email, "candidate@test.com");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("POST /auth/login remains alias for HR login", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.deepEqual(body.user, {
      id: "user_hr",
      email: "hr@test.com",
      role: "HR",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("GET /auth/me returns user when authenticated", async () => {
  const passwordHash = hashPassword("123456");
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAuthRouter(() =>
      makeFakePrisma({
        id: "user_hr",
        email: "hr@test.com",
        passwordHash,
        role: "HR",
      }) as never
    )
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/hr/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hr@test.com", password: "123456" }),
    });
    const { token } = await loginRes.json();

    const meRes = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(meRes.status, 200);
    const body = await meRes.json();
    assert.deepEqual(body.user, {
      id: "user_hr",
      email: "hr@test.com",
      role: "HR",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
