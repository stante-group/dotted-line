import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { RS, RS_HOSTS, RS_PATTERNS, RS_DOMAINS, isRs, draftIdOf, packetIdOf, HOME_URL } from "../src/lib/sites.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));

// Real moved Real Signature to a new address without notice (2026-11-18). Every place the
// manifest names it must list every address in sites.js, or Dotted Line goes deaf on one.
test("the manifest grants Real's two domains, and runs the script on Real Signature only", () => {
  const real = (list) => list.filter((m) => /realremaxgroup|therealbrokerage/.test(m)).sort();
  // Domains, not addresses: the next move inside one is an update with no Re-enable.
  assert.deepEqual(real(manifest.host_permissions), [...RS_DOMAINS].sort(), "host_permissions");
  // Exact addresses: never on Real's sign-in page (bolt.) or reZEN.
  const want = [...RS_PATTERNS].sort();
  assert.deepEqual(real(manifest.content_scripts.find((c) => c.js.includes("src/realsig/content.js")).matches), want, "content_scripts");
  assert.deepEqual(real(manifest.web_accessible_resources[0].matches), want, "web_accessible_resources");
});

test("every Real Signature address is inside a granted domain (a third domain would need a Re-enable)", () => {
  const inside = (h) => RS_DOMAINS.some((d) => {
    const dom = d.replace("https://*.", "").replace("/*", "");
    const host = new URL(h).hostname;
    return host === dom || host.endsWith(`.${dom}`);
  });
  for (const h of RS_HOSTS) assert.ok(inside(h), h);
  assert.ok(!inside("https://signature.example.com/"), "the check can fail");
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
  const src = new URL("../src/", import.meta.url);
  const files = readdirSync(src, { recursive: true }).filter((f) => /\.(js|html)$/.test(f) && !/lib[\\/]sites\.js$/.test(f));
  assert.ok(files.length > 20, `read ${files.length} files`);
  for (const f of files) {
    const s = readFileSync(new URL(f.replaceAll("\\", "/"), src), "utf8");
    // Escaped too: the old address sat in a regex (signature\.therealbrokerage\.com), which
    // the plain spelling missed, and Check before you send would never have run (2026-11-24).
    assert.ok(!/signature\\*\.(?:therealbrokerage|realremaxgroup)\\*\.com/.test(s), f);
  }
});
