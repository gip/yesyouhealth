import assert from "node:assert/strict";
import test from "node:test";

import { pendingMigrations } from "../scripts/migrate";

test("returns unapplied migrations in lexicographic order", () => {
  const available = ["0002_seed_fields.sql", "0001_init.sql", "0003_later.sql"];
  assert.deepEqual(pendingMigrations(["0001_init.sql"], available), [
    "0002_seed_fields.sql",
    "0003_later.sql",
  ]);
});

test("returns nothing when everything is applied", () => {
  const files = ["0001_init.sql", "0002_seed_fields.sql"];
  assert.deepEqual(pendingMigrations(files, files), []);
});

test("returns everything for a fresh database", () => {
  assert.deepEqual(pendingMigrations([], ["0001_init.sql"]), ["0001_init.sql"]);
});
