// Custom-rules ↔ own-GitHub-repo sync (lib/gh-repo.ts): the merge is the
// heart of the two-way flow — repo edits land locally, local additions are
// pushed back, and a conflict keeps the local category.
import assert from "node:assert/strict";
import test from "node:test";
import { mergeRules } from "../lib/gh-repo";
import type { CustomRule } from "../lib/local-rules";

const rule = (pattern: string, field: CustomRule["field"], category: CustomRule["category"]): CustomRule => ({
  pattern,
  field,
  category,
});

test("merge: repo rows missing locally are pulled in", () => {
  const local = [rule("加微信", "any", "marketing")];
  const remote = [rule("菠菜", "tweet", "gambling"), rule("加微信", "any", "marketing")];
  const { merged, pulled } = mergeRules(local, remote);
  assert.equal(pulled, 1);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((r) => r.pattern === "菠菜" && r.category === "gambling"));
});

test("merge: same pattern+field with different category keeps the LOCAL one", () => {
  const local = [rule("加V", "handle", "porn")];
  const remote = [rule("加V", "handle", "crypto")];
  const { merged, pulled } = mergeRules(local, remote);
  assert.equal(pulled, 0);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.category, "porn");
});

test("merge: pattern match is case-insensitive on the local side", () => {
  const local = [rule("USDT", "tweet", "crypto")];
  const remote = [rule("usdt", "tweet", "crypto")];
  const { merged, pulled } = mergeRules(local, remote);
  assert.equal(pulled, 0);
  assert.equal(merged.length, 1);
});

test("merge: same pattern on a DIFFERENT field is a distinct rule", () => {
  const local = [rule("福利", "bio", "porn")];
  const remote = [rule("福利", "tweet", "porn")];
  const { merged, pulled } = mergeRules(local, remote);
  assert.equal(pulled, 1);
  assert.equal(merged.length, 2);
});

test("merge: empty remote is a no-op pull", () => {
  const local = [rule("网赚", "any", "marketing")];
  const { merged, pulled } = mergeRules(local, []);
  assert.equal(pulled, 0);
  assert.equal(merged.length, 1);
});
