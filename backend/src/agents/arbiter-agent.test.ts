import test from "node:test";
import assert from "node:assert/strict";
import type { LiveAuthorType } from "@prisma/client";
import { ArbiterReplyParseError, buildArbiterMessages, parseArbiterReply } from "./arbiter-agent";
import { ARBITER_AGENT_SYSTEM_PROMPT_UK } from "./prompts/arbiter-agent.uk";

const companyProfile = {
  role: "Backend Developer",
  requirements: ["Node.js", "PostgreSQL"],
  culture: ["remote-first"],
  expectations: ["ownership"],
};

const candidateProfile = {
  summary: "5 років досвіду",
  experience: ["Acme Corp"],
  skills: { strong: ["TypeScript"], growth: ["DevOps"] },
  goals: ["senior role"],
};

test("parseArbiterReply parses post:false", () => {
  const result = parseArbiterReply('{ "post": false }');
  assert.equal(result.post, false);
  assert.equal(result.message, undefined);
});

test("parseArbiterReply parses post:true with message", () => {
  const result = parseArbiterReply('{ "post": true, "message": "Продовжуйте тему досвіду." }');
  assert.equal(result.post, true);
  assert.equal(result.message, "Продовжуйте тему досвіду.");
});

test("parseArbiterReply strips markdown code fences", () => {
  const raw = "```json\n{ \"post\": false }\n```";
  const result = parseArbiterReply(raw);
  assert.equal(result.post, false);
});

test("parseArbiterReply throws on invalid JSON", () => {
  assert.throws(() => parseArbiterReply("not json"), ArbiterReplyParseError);
});

test("parseArbiterReply throws when post:true but message is empty", () => {
  assert.throws(
    () => parseArbiterReply('{ "post": true, "message": "   " }'),
    ArbiterReplyParseError,
  );
});

test("parseArbiterReply throws when post field is missing", () => {
  assert.throws(() => parseArbiterReply('{ "message": "hi" }'), ArbiterReplyParseError);
});

test("buildArbiterMessages includes profiles in system prompt and maps history", () => {
  const history: Array<{ authorType: LiveAuthorType; content: string }> = [
    { authorType: "HUMAN_HR", content: "Розкажіть про досвід." },
    { authorType: "HUMAN_CANDIDATE", content: "Працював з Node.js." },
    { authorType: "AGENT_ARBITER", content: "Короткий підсумок." },
  ];

  const messages = buildArbiterMessages({ companyProfile, candidateProfile, history });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Backend Developer/);
  assert.match(messages[0].content, /5 років досвіду/);
  assert.ok(
    messages[0].content.includes(
      ARBITER_AGENT_SYSTEM_PROMPT_UK.split("{{COMPANY_PROFILE}}")[0].trimEnd(),
    ),
  );

  assert.deepEqual(messages[1], { role: "user", content: "[HR] Розкажіть про досвід." });
  assert.deepEqual(messages[2], { role: "user", content: "[Кандидат] Працював з Node.js." });
  assert.deepEqual(messages[3], { role: "assistant", content: "Короткий підсумок." });
});
