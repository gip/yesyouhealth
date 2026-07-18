import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  providerClientId,
  providerScope,
  PROVIDER_REGISTRY_VERSION,
  selectableProviders,
} from "../lib/providers";

test("preselects UCSF and lists production organizations", () => {
  assert.equal(DEFAULT_PROVIDER_ID, "ucsf");
  assert.equal(PROVIDER_REGISTRY_VERSION, 1);
  assert.deepEqual(
    selectableProviders().map((provider) => provider.id),
    ["ucsf", "sutter"],
  );
});

test("includes the Epic sandbox only when requested", () => {
  assert.deepEqual(
    selectableProviders(true).map((provider) => provider.id),
    ["ucsf", "sutter", "epic-sandbox"],
  );
});

test("resolves only allowlisted organization profiles", () => {
  assert.equal(getProvider("sutter")?.name, "Sutter Health");
  assert.equal(getProvider("unknown"), undefined);
});

test("allows organization-specific OAuth overrides", () => {
  const provider = {
    ...getProvider("ucsf")!,
    clientId: "organization-client",
    scope: "launch/patient patient/*.rs",
  };
  assert.equal(providerClientId(provider, "default-client"), "organization-client");
  assert.equal(providerScope(provider, "default-scope"), "launch/patient patient/*.rs");
});
