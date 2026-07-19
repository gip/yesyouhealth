import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import demoLongitudinal from "../public/demo/john-smith-longitudinal.json";
import { normalizeDemoLongitudinal } from "../lib/demo-study";
import { isLongitudinalStudy } from "../lib/study";

test("bundled demo result is a valid longitudinal study", () => {
  const demoStudy = normalizeDemoLongitudinal(demoLongitudinal);
  assert.equal(isLongitudinalStudy(demoStudy), true);
  assert.equal(demoStudy.timeline.length, 19);
  assert.equal(demoStudy.timeline.at(-1)?.date, "2052-06-18");
  assert.match(demoStudy.narrative_markdown, /John Smith/);
});

test("bundled de-identified demo record is valid JSON", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../public/demo/deidentified-john-smith.json", import.meta.url),
      "utf8",
    ),
  ) as { data?: unknown };
  assert.equal(typeof fixture.data, "object");
});
