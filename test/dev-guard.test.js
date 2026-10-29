// The test WEBForms page (dev/) is for test copies only, wired in by dev/apply.mjs on the
// copy's own files. The shipped extension (manifest + src + icons) must not know it exists:
// no import, no link, no switch (Dan, 2026-10-29: "i dont want to introduce any backdoor in
// the shipped version").

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : [p];
});
const SHIPPED = [join(root, "manifest.json"), ...files(join(root, "src")), ...files(join(root, "icons"))];
const MENTIONS = /dev\/|sim-hooks|webforms\.html|DEV-SIM|devsim/;

test("nothing that ships mentions the test WEBForms page", () => {
  const hits = SHIPPED.filter((f) => !/\.(png|jpg|ico)$/i.test(f) && MENTIONS.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(root.length));
  assert.deepEqual(hits, []);
});

test("the manifest exposes no extension page to websites beyond src/lib", () => {
  const mf = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const exposed = (mf.web_accessible_resources || []).flatMap((w) => w.resources);
  assert.deepEqual(exposed, ["src/lib/*.js"]);
});

test("the test page's download unzips and pairs like WEBForms' own", async () => {
  const { storedZip, people } = await import("../dev/sim-hooks.js");
  const { unzip } = await import("../src/lib/unzip.js");
  const { pairEntries, zipEntryName } = await import("../src/lib/webforms-api.js");
  const forms = [{ id: "a", name: "Seller's Disclosure" }, { id: "b", name: "Offer 1/2" }];
  const data = [new Uint8Array([37, 80, 68, 70, 1, 2, 3]), new Uint8Array([37, 80, 68, 70, 9])];
  const zip = storedZip(forms.map((f, i) => ({ name: zipEntryName(f.name), data: data[i] })));
  const paired = pairEntries(forms, await unzip(zip));
  assert.deepEqual(paired.map((p) => [p.form.id, [...p.data]]), [["a", [...data[0]]], ["b", [...data[1]]]]);
  assert.deepEqual(people("Jordan Sample, jordan@example.com\n\nRiley Q Example", "BUYER"), [
    { role: "BUYER", firstName: "Jordan", lastName: "Sample", email: "jordan@example.com" },
    { role: "BUYER", firstName: "Riley Q", lastName: "Example", email: "" },
  ]);
});

// Caught here, not when Dan next builds a test copy: a panel or worker change that moves
// the lines apply.mjs edits.
test("apply.mjs still wires a fresh copy, and only the copy", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dl-dev-"));
  try {
    for (const p of ["manifest.json", "src", "dev"]) cpSync(join(root, p), join(tmp, p), { recursive: true });
    const before = readFileSync(join(root, "src/panel/panel.js"), "utf8");
    execFileSync(process.execPath, [join(root, "dev/apply.mjs"), tmp, "test"], { stdio: "pipe" });
    assert.match(readFileSync(join(tmp, "src/panel/panel.js"), "utf8"), /DEV-SIM/);
    assert.match(readFileSync(join(tmp, "src/background.js"), "utf8"), /DEV-SIM/);
    assert.equal(JSON.parse(readFileSync(join(tmp, "manifest.json"), "utf8")).version_name, "test");
    assert.equal(readFileSync(join(root, "src/panel/panel.js"), "utf8"), before);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
