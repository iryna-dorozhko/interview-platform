import test from "node:test";
import assert from "node:assert/strict";
import express, { type Request, type Response } from "express";
import { requireAuth, requireHr, requireCandidate } from "./middleware";
import { signToken } from "./jwt";

const ORIGINAL_SECRET = process.env.JWT_SECRET;
test.before(() => {
  process.env.JWT_SECRET = "test-secret-min-8-chars";
});
test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
});

test("requireAuth returns 401 without Authorization header", async () => {
  const app = express();
  app.get("/protected", requireAuth, (_req, res) => res.status(200).json({ ok: true }));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/protected`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Unauthorized");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("requireAuth sets req.user with valid token", async () => {
  const token = signToken({ sub: "u1", email: "hr@test.com", role: "HR" });
  let capturedEmail: string | undefined;

  const app = express();
  app.get(
    "/protected",
    requireAuth,
    (req: Request, res: Response) => {
      capturedEmail = req.user?.email;
      res.status(200).json({ ok: true });
    }
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(capturedEmail, "hr@test.com");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("requireHr returns 403 for CANDIDATE role", async () => {
  const token = signToken({ sub: "u2", email: "cd@test.com", role: "CANDIDATE" });

  const app = express();
  app.get("/hr-only", requireAuth, requireHr, (_req, res) => res.status(200).json({ ok: true }));

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/hr-only`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("requireCandidate returns 403 for HR role", async () => {
  const token = signToken({ sub: "u1", email: "hr@test.com", role: "HR" });

  const app = express();
  app.get(
    "/candidate-only",
    requireAuth,
    requireCandidate,
    (_req, res) => res.status(200).json({ ok: true })
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/candidate-only`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Forbidden");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("requireCandidate allows CANDIDATE role", async () => {
  const token = signToken({ sub: "u2", email: "cd@test.com", role: "CANDIDATE" });

  const app = express();
  app.get(
    "/candidate-only",
    requireAuth,
    requireCandidate,
    (_req, res) => res.status(200).json({ ok: true })
  );

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/candidate-only`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
