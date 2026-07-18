import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "../lib/server/password";

test("hashes and verifies a password", async () => {
  const encoded = await hashPassword("correct horse battery");
  assert.match(encoded, /^\$argon2id\$v=1\$m=65536,t=3,p=1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword("correct horse battery", encoded), true);
});

test("rejects a wrong password", async () => {
  const encoded = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword("incorrect horse battery", encoded), false);
});

test("produces distinct salts per hash", async () => {
  const first = await hashPassword("correct horse battery");
  const second = await hashPassword("correct horse battery");
  assert.notEqual(first, second);
});

test("verifies against parameters parsed from the stored hash", async () => {
  // A hash produced with weaker historical parameters still verifies.
  const legacy =
    "$argon2id$v=1$m=8,t=1,p=1$" +
    Buffer.alloc(16, 1).toString("base64") +
    "$" +
    Buffer.from(
      await (await import("@noble/hashes/argon2.js")).argon2idAsync(
        new TextEncoder().encode("correct horse battery"),
        Buffer.alloc(16, 1),
        { m: 8, t: 1, p: 1, dkLen: 32 },
      ),
    ).toString("base64");
  assert.equal(await verifyPassword("correct horse battery", legacy), true);
});

test("rejects malformed stored hashes without throwing", async () => {
  assert.equal(await verifyPassword("whatever-password", "not-a-hash"), false);
  assert.equal(await verifyPassword("whatever-password", "$argon2id$v=9$m=1,t=1,p=1$AA$AA"), false);
  assert.equal(await verifyPassword("whatever-password", ""), false);
});

test("enforces the minimum password length when hashing", async () => {
  await assert.rejects(hashPassword("short"), /at least/);
  assert.equal(MIN_PASSWORD_LENGTH, 12);
});
