import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RS, RS_HOSTS, RS_PATTERNS, isRs, draftIdOf, packetIdOf, HOME_URL } from "../src/lib/sites.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));

// Real moved Real Signature to a new address without notice (2026-11-18). Every place the
// manifest names it must list every address in sites.js, or Dotted Line goes deaf on one.
test("the manifest names every Real Signature address, in all three places", () => {
  const rs = (list) => list.filter((m) => /signature\./.test(m)).sort();
  const want = [...RS_PATTERNS].sort();
  assert.deepEqual(rs(manifest.host_permissions), want, "host_permissions");
  assert.deepEqual(rs(manifest.content_scripts.find((c) => c.js.includes("src/realsig/content.js")).matches), want, "content_scripts");
  assert.deepEqual(rs(manifest.web_accessible_resources[0].matches), want, "web_accessible_resources");
});

test("new Real Signature links are built on the new address", () => {
  assert.equal(RS, "https://signature.realremaxgroup.com/");
  assert.equal(new URL("/home/draft", RS).href, "https://signature.realremaxgroup.com/home/draft");
});

test("both addresses count as Real Signature; look-alikes and other sites don't", () => {
  for (const h of RS_HOSTS) assert.ok(isRs(`${h}home/sent-for-signature`), h);
  for (const u of ["https://pr.transactiondesk.com/", "https://signature.realremaxgroup.com.example.com/",
    "https://bolt.therealbrokerage.com/login", "http://signature.realremaxgroup.com/", "", undefined, null]) {
    assert.ok(!isRs(u), String(u));
  }
});

test("the panel's page patterns match on both addresses, and nowhere else", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  for (const h of RS_HOSTS) {
    assert.equal(draftIdOf(`${h}one-time-documents/document/${id}`), id, h);
    assert.equal(draftIdOf(`${h}view/document/${id}?oneTimeUse=true`), id, h);
    assert.equal(packetIdOf(`${h}one-time-documents/packet/${id}/edit`), id, h);
    assert.equal(packetIdOf(`${h}view/packet/${id}?x=1&oneTimeUse=true`), id, h);
    assert.ok(HOME_URL.test(`${h}home/sent-for-signature`), h);
  }
  assert.equal(draftIdOf(`https://signature.realremaxgroup.com.example.com/one-time-documents/document/${id}`), null);
  assert.equal(draftIdOf(`https://signature.realremaxgroup.com/view/document/${id}`), null, "a sent document's view");
  assert.ok(!HOME_URL.test("https://signature.realremaxgroup.com/homework"));
});

test("no source file names a Real Signature app address except sites.js", () => {
  const files = ["src/background.js", "src/panel/panel.js", "src/setup-check.js", "src/options/import.js", "src/messaging.js", "src/realsig/content.js"];
  for (const f of files) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/signature\.(?:therealbrokerage|realremaxgroup)\.com/.test(s), f);
  }
});
