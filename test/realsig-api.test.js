import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { RealSignature, isForbidden, readToken, NotSignedIn } from "../src/lib/realsig-api.js";

test("sending routes are refused", () => {
  assert.ok(isForbidden("POST", "/documents"));
  assert.ok(isForbidden("post", "/documents/"));
  assert.ok(isForbidden("POST", "/documents/abc/resend-signature-email"));
  assert.ok(isForbidden("POST", "/packets"));
  assert.ok(isForbidden("DELETE", "/documents/abc"));
  assert.ok(isForbidden("POST", "/packets/abc/recipients"));
  assert.ok(isForbidden("DELETE", "/packets/abc"));
  assert.ok(isForbidden("PUT", "/packets/abc/signees/s1"));
  assert.ok(!isForbidden("POST", "/document-templates"));
  assert.ok(!isForbidden("PUT", "/document-templates/abc"));
  assert.ok(!isForbidden("DELETE", "/document-templates/abc"));
  assert.ok(!isForbidden("POST", "/packet-templates"));
  assert.ok(!isForbidden("DELETE", "/packet-templates/abc"));
});

test("a packet draft is a one-time packet template, never /packets", async () => {
  const seen = [];
  const rs = new RealSignature({
    getToken: () => "tok",
    fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, text: async () => '{"id":"p1"}' }; },
  });
  assert.deepEqual(await rs.createPacketDraft("120 Example Street NW", ["d1", "d2"]), { id: "p1" });
  assert.ok(seen[0].url.endsWith("/packet-templates"));
  assert.deepEqual(JSON.parse(seen[0].init.body),
    { name: "120 Example Street NW", oneTimeUse: true, documentTemplates: [{ documentTemplateId: "d1" }, { documentTemplateId: "d2" }] });
});

test("request() refuses a send even if a method tries one", async () => {
  let called = false;
  const rs = new RealSignature({ getToken: () => "t", fetchImpl: async () => { called = true; } });
  await assert.rejects(rs.request("POST", "/documents", { json: {} }), /refused/);
  assert.equal(called, false);
});

test("no source file contains a send call", () => {
  // Belt and braces: the client must never grow a sendDocument(), and nothing under src/
  // may build the send route by hand.
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  for (const f of walk(new URL("../src", import.meta.url).pathname).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/resend-signature-email["'`]/.test(src.replace(/\/resend-signature-email\$\//, "")), `${f} calls resend`);
    assert.ok(!/\bsend(Document|Packet|ForSignature)\b/.test(src), `${f} defines a send function`);
  }
});

test("token is read per call from the cookie, and a missing one says sign in", async () => {
  assert.equal(readToken("a=1; jwtToken=abc.def; b=2"), "abc.def");
  assert.equal(readToken("a=1"), null);
  const rs = new RealSignature({ getToken: () => null, fetchImpl: async () => ({}) });
  await assert.rejects(rs.getTemplate("x"), NotSignedIn);
});

test("bearer header and query are sent; 204 returns null", async () => {
  const seen = [];
  const rs = new RealSignature({
    getToken: () => "tok",
    fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 204, text: async () => "" }; },
  });
  assert.equal(await rs.putDraft("d1", { name: "x" }), null);
  assert.equal(seen[0].init.headers.Authorization, "Bearer tok");
  assert.equal(seen[0].init.method, "PUT");
  assert.ok(seen[0].url.endsWith("/document-templates/d1"));
});
