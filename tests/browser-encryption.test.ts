import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserEncryption,
  decryptJson,
  encryptJson,
  unlockBrowserEncryption,
} from "../lib/browser-encryption";

const passphrase = "correct horse battery staple";

test("derives an Argon2id key and decrypts authenticated ciphertext", async () => {
  const created = await createBrowserEncryption(passphrase);
  const payload = await encryptJson(
    { resourceType: "Patient", id: "example" },
    created,
    "test:patient",
  );
  const unlocked = await unlockBrowserEncryption(passphrase, created.metadata);

  assert.equal(created.metadata.kdf, "argon2id");
  assert.equal(created.metadata.algorithm, "AES-GCM");
  assert.deepEqual(
    await decryptJson(payload, unlocked, "test:patient"),
    { resourceType: "Patient", id: "example" },
  );
});

test("rejects incorrect passphrases and changed authenticated context", async () => {
  const created = await createBrowserEncryption(passphrase);
  const payload = await encryptJson("protected", created, "test:context");
  const incorrect = await unlockBrowserEncryption(
    "this passphrase is not correct",
    created.metadata,
  );

  await assert.rejects(
    decryptJson(payload, incorrect, "test:context"),
    /passphrase is incorrect|record is damaged/,
  );
  await assert.rejects(
    decryptJson(payload, created, "test:other-context"),
    /passphrase is incorrect|record is damaged/,
  );
});

test("requires a passphrase with at least twelve characters", async () => {
  await assert.rejects(
    createBrowserEncryption("too short"),
    /at least 12 characters/,
  );
});
