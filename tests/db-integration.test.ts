import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL is not set; skipping database integration tests.";

if (TEST_DATABASE_URL) {
  // The pool in lib/server/db.ts reads DATABASE_URL lazily on first use.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

before(async () => {
  if (!TEST_DATABASE_URL) return;
  const { runMigrations } = await import("../scripts/migrate");
  await runMigrations(TEST_DATABASE_URL, () => {});
  const { query } = await import("../lib/server/db");
  await query("TRUNCATE users CASCADE");
});

after(async () => {
  if (!TEST_DATABASE_URL) return;
  const { getPool } = await import("../lib/server/db");
  await getPool().end();
});

test("credentials signup enforces unique email case-insensitively", { skip }, async () => {
  const users = await import("../lib/server/users");
  const created = await users.createCredentialsUser({
    email: "doc@example.com",
    name: "Doc",
    passwordHash: "$argon2id$fake",
    role: "doctor",
    fieldIds: [1, 2],
  });
  assert.equal(created.role, "doctor");
  await assert.rejects(
    users.createCredentialsUser({
      email: "DOC@example.com",
      name: "Doc 2",
      passwordHash: "$argon2id$fake",
      role: "doctor",
      fieldIds: [1],
    }),
    users.DuplicateEmailError,
  );
  const found = await users.findUserByEmail("Doc@Example.com");
  assert.equal(found?.id, created.id);
});

test("the max-two-fields trigger rejects a third field", { skip }, async () => {
  const { query } = await import("../lib/server/db");
  const users = await import("../lib/server/users");
  const user = await users.createCredentialsUser({
    email: "maxfields@example.com",
    name: null,
    passwordHash: "$argon2id$fake",
    role: "patient",
    fieldIds: [1, 2],
  });
  await assert.rejects(
    query("INSERT INTO user_fields (user_id, field_id) VALUES ($1, 3)", [user.id]),
    /maximum of 2 fields/,
  );
});

test("replaceUserFields swaps fields atomically within the trigger's limits", { skip }, async () => {
  const users = await import("../lib/server/users");
  const fields = await import("../lib/server/fields");
  const user = await users.createCredentialsUser({
    email: "swap@example.com",
    name: null,
    passwordHash: "$argon2id$fake",
    role: "patient",
    fieldIds: [1, 2],
  });
  await users.replaceUserFields(user.id, [3, 4]);
  assert.deepEqual(
    (await fields.fieldsForUser(user.id)).map((field) => field.id),
    [3, 4],
  );
});

test("OAuth users onboard once and only once", { skip }, async () => {
  const users = await import("../lib/server/users");
  const created = await users.createOAuthUser({
    email: "google@example.com",
    name: "G User",
    image: null,
    provider: "google",
    providerAccountId: "google-sub-1",
  });
  assert.equal(created.role, null);
  const viaAccount = await users.findUserByAccount("google", "google-sub-1");
  assert.equal(viaAccount?.id, created.id);

  assert.equal(await users.setRoleAndFields(created.id, "patient", [5]), true);
  assert.equal(await users.setRoleAndFields(created.id, "doctor", [1]), false);
  const reloaded = await users.findUserById(created.id);
  assert.equal(reloaded?.role, "patient");
});

test("literature insert is guarded by the doctor's fields", { skip }, async () => {
  const users = await import("../lib/server/users");
  const literature = await import("../lib/server/literature");
  const doctor = await users.createCredentialsUser({
    email: "gi-doc@example.com",
    name: "Dr. GI",
    passwordHash: "$argon2id$fake",
    role: "doctor",
    fieldIds: [2],
  });

  const input = {
    fieldId: 2,
    title: "Microbiome effects",
    authors: "Doe J",
    journal: "Gut",
    year: 2023,
    doi: "10.1000/gut123",
    pubmedUrl: null,
  };
  const id = await literature.addLiterature(doctor.id, input);
  assert.notEqual(id, null);

  const foreignField = await literature.addLiterature(doctor.id, { ...input, fieldId: 3 });
  assert.equal(foreignField, null);

  const bySlug = await literature.listLiterature({ fieldSlug: "gi-health" });
  assert.equal(bySlug.length, 1);
  assert.equal(bySlug[0]?.doctor_name, "Dr. GI");
  assert.equal(bySlug[0]?.field_name, "GI Health");

  const byDoctor = await literature.listLiterature({ doctorId: doctor.id });
  assert.equal(byDoctor.length, 1);
});

test("database CHECK constraints back up app validation", { skip }, async () => {
  const { query } = await import("../lib/server/db");
  const users = await import("../lib/server/users");
  const doctor = await users.createCredentialsUser({
    email: "checks@example.com",
    name: null,
    passwordHash: "$argon2id$fake",
    role: "doctor",
    fieldIds: [1],
  });
  // Neither DOI nor PubMed URL.
  await assert.rejects(
    query(
      `INSERT INTO literature (doctor_id, field_id, title, authors, journal, year)
       VALUES ($1, 1, 'T', 'A', 'J', 2020)`,
      [doctor.id],
    ),
  );
  // Malformed DOI.
  await assert.rejects(
    query(
      `INSERT INTO literature (doctor_id, field_id, title, authors, journal, year, doi)
       VALUES ($1, 1, 'T', 'A', 'J', 2020, 'not-a-doi')`,
      [doctor.id],
    ),
  );
});
