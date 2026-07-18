import assert from "node:assert/strict";
import test from "node:test";

import {
  equalOAuthState,
  OAUTH_TRANSACTION_MAX_AGE_MS,
  parseOAuthTransaction,
  resolveRedirectUri,
} from "../lib/browser-flow";

const transaction = {
  state: "state-value",
  verifier: "verifier-value",
  providerId: "ucsf",
  providerRegistryVersion: 1,
  redirectUri: "https://yesyou.example/callback",
  createdAt: 1_000_000,
  includeAttachments: false,
  browserStorage: {
    persistent: true,
    quota: 1_000_000,
    usage: 1_000,
  },
};

test("uses the current origin for an unconfigured callback", () => {
  assert.equal(
    resolveRedirectUri(null, "http://localhost:3000"),
    "http://localhost:3000/callback",
  );
});

test("rejects an insecure production callback", () => {
  assert.throws(
    () => resolveRedirectUri("http://yesyou.example/callback", "https://yesyou.example"),
    /must use HTTPS/,
  );
});

test("parses a current browser OAuth transaction", () => {
  assert.deepEqual(
    parseOAuthTransaction(JSON.stringify(transaction), transaction.createdAt + 1_000),
    transaction,
  );
});

test("rejects expired and malformed browser OAuth transactions", () => {
  assert.equal(
    parseOAuthTransaction(
      JSON.stringify(transaction),
      transaction.createdAt + OAUTH_TRANSACTION_MAX_AGE_MS + 1,
    ),
    undefined,
  );
  assert.equal(parseOAuthTransaction("not-json", transaction.createdAt), undefined);
  assert.equal(
    parseOAuthTransaction(
      JSON.stringify({ ...transaction, providerId: "untrusted-provider" }),
      transaction.createdAt,
    ),
    undefined,
  );
});

test("compares OAuth state without returning early for content", () => {
  assert.equal(equalOAuthState("state-value", "state-value"), true);
  assert.equal(equalOAuthState("state-value", "state-other"), false);
  assert.equal(equalOAuthState("short", "longer"), false);
});
