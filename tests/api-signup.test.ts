import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL is not set; skipping signup API tests.";

if (TEST_DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

function signupRequest(body: unknown): Request {
  return new Request("http://localhost/api/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(async () => {
  if (!TEST_DATABASE_URL) return;
  const { runMigrations } = await import("../scripts/migrate");
  await runMigrations(TEST_DATABASE_URL, () => {});
  const { query } = await import("../lib/server/db");
  await query("DELETE FROM users WHERE email LIKE '%@signup-test.example'");
});

after(async () => {
  if (!TEST_DATABASE_URL) return;
  const { getPool } = await import("../lib/server/db");
  await getPool().end();
});

test("creates a doctor account and rejects the duplicate", { skip }, async () => {
  const { POST } = await import("../app/api/signup/route");

  const created = await POST(
    signupRequest({
      email: "doc@signup-test.example",
      password: "a-long-enough-password",
      name: "Dr. Test",
      role: "doctor",
      fieldIds: [1, 2],
    }),
  );
  assert.equal(created.status, 201);
  const createdBody = (await created.json()) as { id: string; role: string };
  assert.equal(createdBody.role, "doctor");

  const verifiable = await import("../lib/server/users");
  const stored = await verifiable.findUserByEmail("doc@signup-test.example");
  assert.equal(stored?.id, createdBody.id);
  assert.notEqual(stored?.password_hash, "a-long-enough-password");

  const duplicate = await POST(
    signupRequest({
      email: "DOC@signup-test.example",
      password: "a-long-enough-password",
      role: "patient",
      fieldIds: [1],
    }),
  );
  assert.equal(duplicate.status, 409);
});

test("rejects invalid signup payloads", { skip }, async () => {
  const { POST } = await import("../app/api/signup/route");

  const badJson = await POST(
    new Request("http://localhost/api/signup", { method: "POST", body: "not json" }),
  );
  assert.equal(badJson.status, 400);

  const tooManyFields = await POST(
    signupRequest({
      email: "many@signup-test.example",
      password: "a-long-enough-password",
      role: "patient",
      fieldIds: [1, 2, 3],
    }),
  );
  assert.equal(tooManyFields.status, 400);
});
