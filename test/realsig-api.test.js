import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { RealSignature, isForbidden, readToken, readActingAs, readMyDocuments, NotSignedIn } from "../src/lib/realsig-api.js";

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

test("a TC acting for an agent: cookie read, X-Agent-Context sent", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(readActingAs(`jwtToken=x; actingAsUserId=${id}; other=1`), id);
  assert.equal(readActingAs(`actingAsUserId=%22${id}%22`), id);
  for (const none of ["jwtToken=x", "actingAsUserId=", "actingAsUserId=null", ""]) assert.equal(readActingAs(none), null);
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.headers); return { ok: true, status: 200, text: async () => "{}" }; };
  await new RealSignature({ getToken: () => "t", getActingAs: () => id, fetchImpl }).me();
  await new RealSignature({ getToken: () => "t", fetchImpl }).me();
  assert.equal(seen[0]["X-Agent-Context"], id);
  assert.ok(!("X-Agent-Context" in seen[1]), "an agent's own calls carry no agent context");
});

test("a 403 from an expired sign-in counts as signed out; a real refusal stays a 403", async () => {
  const answer = (map) => async (url) => {
    const k = Object.keys(map).find((x) => url.includes(x));
    return { ok: false, status: map[k], text: async () => "" };
  };
  // The profile itself refused: signed out.
  await assert.rejects(new RealSignature({ getToken: () => "t", fetchImpl: answer({ "/users/me": 403 }) }).me(), NotSignedIn);
  // A draft refused, and the profile too: signed out.
  await assert.rejects(new RealSignature({ getToken: () => "t", fetchImpl: answer({ "/document-templates/": 403, "/users/me": 403 }) }).getTemplate("x"), NotSignedIn);
  // A draft refused, but the profile reads fine: a genuine 403, reported as before.
  const ok = async (url) => (url.includes("/users/me") ? { ok: true, status: 200, text: async () => "{}" } : { ok: false, status: 403, text: async () => "" });
  await assert.rejects(new RealSignature({ getToken: () => "t", fetchImpl: ok }).getTemplate("x"), (e) => !(e instanceof NotSignedIn) && /→ 403/.test(e.message));
  // A TC acting for an agent: the profile is 404, so the draft's 403 stands.
  await assert.rejects(new RealSignature({ getToken: () => "t", getActingAs: () => "a1", fetchImpl: answer({ "/document-templates/": 403, "/users/me": 404 }) }).getTemplate("x"),
    (e) => !(e instanceof NotSignedIn));
});

test("no answer from Real Signature: a plain message, network in reports, and a write flagged as maybe made", async () => {
  const { classifyError } = await import("../src/lib/report.js");
  const dropped = new RealSignature({ getToken: () => "t", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  const e1 = await dropped.request("POST", "/document-templates", { form: new FormData() }).catch((e) => e);
  assert.match(e1.message, /^Couldn't reach Real Signature/);
  assert.equal(e1.leftover, true);
  assert.equal(classifyError(e1).cls, "network");
  const e2 = await dropped.request("GET", "/users/me").catch((e) => e);
  assert.equal(e2.leftover, false); // a read leaves nothing behind
  const slow = new RealSignature({ getToken: () => "t", fetchImpl: async (_, o) => {
    assert.ok(o.signal, "every request has a time limit");
    throw new DOMException("signal timed out", "TimeoutError");
  } });
  const e3 = await slow.request("PUT", "/document-templates/abc", { json: {} }).catch((e) => e);
  assert.match(e3.message, /didn't answer in 60 seconds/);
  assert.equal(classifyError(e3).cls, "network");
  const e4 = await slow.request("POST", "/document-templates", { form: new FormData() }).catch((e) => e);
  assert.match(e4.message, /didn't answer in 120 seconds/); // an upload carries the PDF
  // The limit runs on while the body is read: Real Signature said yes, then stalled.
  const stall = new RealSignature({ getToken: () => "t", fetchImpl: async () => ({ ok: true, status: 200,
    text: async () => { throw new DOMException("signal timed out", "TimeoutError"); } }) });
  const e5 = await stall.request("POST", "/document-templates", { form: new FormData() }).catch((e) => e);
  assert.match(e5.message, /didn't answer in 120 seconds/);
  assert.equal(e5.leftover, true); // it was probably made
  assert.equal(classifyError(e5).cls, "network");
  // After a 403, the one look at /users/me has a time limit of its own.
  const looks = [];
  const check = new RealSignature({ getToken: () => "t", fetchImpl: async (url, o) => {
    looks.push(o.signal);
    return { ok: false, status: String(url).includes("/users/me") ? 404 : 403, text: async () => "" };
  } });
  await check.getTemplate("x").catch(() => {});
  assert.equal(looks.length, 2);
  assert.ok(looks.every(Boolean), "the sign-in check can't spin either");
});

test("a TC with no agent picked: /users/me is a 404 in the shape content.js waits on", async () => {
  // realsig/content.js turns exactly this message into "pick whose documents", not an error.
  const rs = new RealSignature({ getToken: () => "t", fetchImpl: async () => ({ ok: false, status: 404, text: async () => "" }) });
  const e = await rs.me().catch((x) => x);
  assert.match(e.message, /^GET \/users\/me → 404\b/);
});

test("My Documents (LITE): SELF is no agent, never sent as X-Agent-Context", async () => {
  // Real's own app leaves SELF out of the header; sending it got a bare 400 on every call
  // (store reports 68-83, Nov 2026).
  for (const c of ["actingAsUserId=SELF", "jwtToken=x; actingAsUserId=%22SELF%22; other=1"]) {
    assert.equal(readActingAs(c), null);
    assert.equal(readMyDocuments(c), true);
  }
  const id = "00000000-0000-4000-8000-000000000001";
  for (const c of [`actingAsUserId=${id}`, "jwtToken=x", "actingAsUserId=null", ""]) assert.equal(readMyDocuments(c), false);
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.headers); return { ok: true, status: 200, text: async () => "{}" }; };
  await new RealSignature({ getToken: () => "t", getActingAs: () => readActingAs("actingAsUserId=SELF"), fetchImpl }).listTemplates();
  assert.equal(seen[0]["X-Agent-Context"], undefined);
});
