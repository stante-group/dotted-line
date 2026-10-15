// The Chrome Web Store refuses an upload over its manifest limits, and only says so at
// upload time (a 160-character description was rejected, 2026-10-15). Check them here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const m = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest fits the Web Store's limits", () => {
  assert.ok(m.name.length <= 75, `name is ${m.name.length} characters (max 75)`);
  assert.ok(m.short_name.length <= 12, `short_name is ${m.short_name.length} characters (max 12)`);
  assert.ok(m.description.length <= 132, `description is ${m.description.length} characters (max 132)`);
  assert.equal(m.version_name, undefined, "version_name is only for stamped test copies");
});

test("manifest asks for no tabs permission", () => {
  // The two host permissions already show our sites' URLs; "tabs" would add an install
  // warning about browsing history for nothing (dropped 2026-10-15).
  assert.ok(!m.permissions.includes("tabs"));
});
