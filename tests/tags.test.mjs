import assert from "node:assert/strict";
import test from "node:test";
import { cleanTag, withTag, ratingGroup, loadLegacyCommonTags } from "../src/types/tags.ts";

test("rating changes replace only the same group, including when twelve tags are selected", () => {
  const tags = [...Array.from({ length: 10 }, (_, index) => `标签${index}`), "容错率：2/5", "实用性：4/5"];
  const changed = withTag(tags, "容错率：5/5");
  assert.equal(changed.length, 12);
  assert.ok(!changed.includes("容错率：2/5"));
  assert.ok(changed.includes("容错率：5/5"));
  assert.ok(changed.includes("实用性：4/5"));
  assert.equal(ratingGroup("容错率:高"), "容错率");
  assert.equal(ratingGroup("防守"), null);
});

test("reuse normalizes prefixes and avoids duplicate selections", () => {
  assert.equal(cleanTag("  ##进攻  "), "进攻");
  assert.deepEqual(withTag(["Smoke"], "#smoke"), ["Smoke"]);
  assert.deepEqual(withTag(["防守"], "  "), ["防守"]);
});

test("legacy favorites preserve empty preference, order and normalized unique names", () => {
  let saved = null;
  globalThis.window = { localStorage: { getItem: () => saved } };
  try {
    assert.deepEqual(loadLegacyCommonTags(), ["默认道具", "进攻", "防守", "残局", "必学"]);
    saved = "[]";
    assert.deepEqual(loadLegacyCommonTags(), []);
    saved = JSON.stringify(["#实用性：5/5", "Smoke", "smoke", null, " ", "进攻"]);
    assert.deepEqual(loadLegacyCommonTags(), ["实用性：5/5", "Smoke", "进攻"]);
    saved = "bad json";
    assert.equal(loadLegacyCommonTags().length, 5);
  } finally {
    delete globalThis.window;
  }
});
