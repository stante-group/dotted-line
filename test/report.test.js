import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, errorReport, okReport, sanitizeReport, draftContext, routeShape, validationShape,
  tallyOk, tallyDue, chromeMajor, slowStep } from "../src/lib/report.js";
import { wfMatch } from "../src/lib/actor.js";

// Invented client details. None of them may ever come out of a report.
const SECRETS = ["Jordan", "Sample", "example.com", "120 Example", "Example Street", "555", "MLS", "A1234567"];
const leaks = (r) => SECRETS.filter((s) => JSON.stringify(r).includes(s));

test("the 70-character subject error: route, field and rule — not the subject", () => {
  const e = new Error("PUT /document-templates/ec2ddb93-1111-2222-3333-444455556666 → 400: defaults.emailSubject: size must be between 0 and 70");
  const c = classifyError(e);
  assert.equal(c.cls, "rejected");
  assert.equal(c.site, "real-signature");
  assert.equal(c.status, 400);
  assert.equal(c.route, "PUT /document-templates/{id}");
  assert.equal(c.field, "defaults.emailSubject");
  assert.equal(c.rule, "size 0-70");
});

test("a validation message that quotes the client's details gives up nothing", () => {
  const e = new Error("PUT /document-templates/x1 → 400: defaults.emailSubject: size must be between 0 and 70 (rejected value '120 Example Street NW - Jordan Sample jordan@example.com')");
  const r = errorReport({ error: e, step: "create", version: "0.1.2", chrome: "141" });
  assert.deepEqual(leaks(r), []);
  assert.equal(r.rule, "size 0-70");
  // A "field" that is really a value, and a rule nobody listed.
  const odd = validationShape("jordan@example.com: is not valid for Jordan Sample");
  assert.equal(odd.field, null);
  assert.equal(odd.rule, null);
  assert.equal(validationShape("name: Jordan Sample is taken").rule, "other");
  assert.equal(validationShape("defaults.signees[3].email: must be a well-formed email address").field, "defaults.signees[n].email");
});

test("routes: ids, names and searches are blanked; only our own route words survive", () => {
  assert.equal(routeShape("get", "/transactions/participant/abc-123/transactions/OPEN?searchText=Jordan"), "GET /transactions/participant/{id}/transactions/OPEN");
  assert.equal(routeShape("GET", "/users/Jordan/Sample"), "GET /users/{id}/{id}");
  assert.equal(routeShape("GET", "/api/forms/single/98765"), "GET /api/forms/single/{id}");
  // The sanitizer refuses a route with a word that isn't ours, however it was built.
  assert.equal(sanitizeReport({ kind: "error", route: "GET /users/Jordan" }).route, null);
});

test("every other field is rebuilt from fixed choices: injected values and keys are dropped", () => {
  const r = sanitizeReport({
    kind: "error", version: "0.1.2 Jordan", chrome: "Chrome Sample", step: "create", cls: "Jordan Sample",
    code: "120 Example Street NW", site: "real-signature", err: "jordan@example.com", status: 400,
    field: "jordan@example.com", rule: "size 0-70 Jordan", partial: "yes", message: "Jordan Sample",
    address: "120 Example Street NW", email: "jordan@example.com", mls: "A1234567",
    ctx: { path: "panel", wf: "Jordan Sample", deal: "120 Example Street NW", forms: "4+", signers: "555",
      clientName: "Jordan Sample", acting: "Jordan", slow: "upload" },
    local: { made: "Jordan", failed: 2, extra: "jordan@example.com" },
  });
  assert.deepEqual(leaks(r), []);
  assert.deepEqual(Object.keys(r).sort(), ["chrome", "cls", "code", "ctx", "err", "field", "kind", "local", "partial", "route", "rule", "site", "status", "step", "v", "version"].sort());
  assert.equal(r.version, "0.0.0");
  assert.equal(r.cls, "ours");
  assert.equal(r.partial, false);
  assert.deepEqual(r.ctx, { path: "panel", acting: false, wf: "none", deal: "none", othersDeal: false, tpl: "none",
    pages: "unknown", forms: "4+", signers: "0", noEmail: false, slow: "upload", warned: false });
  assert.deepEqual(r.local, { made: 0, failed: 2 });
  assert.equal(sanitizeReport({ kind: "gossip" }), null);
});

test("our own messages become codes — the form and template names in them don't travel", () => {
  const cases = [
    ['"Agreement of Purchase and Sale - Jordan Sample" didn\'t come back as a PDF.', "not-pdf", "ours"],
    ["This hand-off has expired. Start again from WEBForms.", "handoff-expired", "interrupted"],
    ["Reload this tab once (the extension was installed or updated after it opened).", "stale-tab", "interrupted"],
    ["reZEN's deal list changed shape", "changed-shape", "changed-shape"],
    ["Real Signature sign-in expired", "unknown", "signed-out"],
    ["Failed to fetch", "unknown", "network"],
    ["WEBForms answered 500 to GET /api/forms/single/12345", "http", "real-server"],
    ["Cannot read properties of undefined (reading 'Jordan')", "unknown", "ours"],
  ];
  for (const [msg, code, cls] of cases) {
    const r = errorReport({ error: new Error(msg), step: "handoff", version: "0.1.2", chrome: "141" });
    assert.equal(r.code, code, msg);
    assert.equal(r.cls, cls, msg);
    assert.deepEqual(leaks(r), [], msg);
  }
  const w = classifyError(new Error("WEBForms answered 500 to GET /api/forms/single/12345"));
  assert.equal(w.site, "webforms");
  assert.equal(w.route, "GET /api/forms/single/{id}");
  const half = classifyError(new Error("PUT /document-templates/x → 400: bad. Check your Real Signature Drafts for a half-made draft and delete it."));
  assert.equal(half.partial, true);
  assert.equal(classifyError(Object.assign(new Error("x"), { name: "NotSignedIn" })).cls, "signed-out");
});

test("the draft's context: categories only", () => {
  const ctx = draftContext({
    path: "panel", acting: true, wf: "own-corp", dealBy: "address", othersDeal: false,
    forms: [{ pageCount: 6 }, { pageCount: 2 }], templates: [{ pagesCount: 6 }, { pagesCount: 3 }],
    signers: 4, noEmail: true, timings: { upload: 12, save: 41.5, oneClickTotal: 90 }, warned: true,
  });
  assert.deepEqual(ctx, { path: "panel", acting: true, wf: "own-corp", deal: "address", othersDeal: false,
    tpl: "all", pages: "differ", forms: "2-3", signers: "3+", noEmail: true, slow: "save", warned: true });
  assert.equal(draftContext({ path: "one-click", forms: [{ pageCount: 6 }], templates: [null] }).pages, "none");
  assert.equal(draftContext({ path: "one-click", forms: [{}, {}], templates: [{ pagesCount: 6 }, null] }).tpl, "some");
  assert.equal(slowStep({ upload: 29 }), "none");
});

test("WEBForms vs Real Signature as a category, never a name", () => {
  const me = { firstName: "Daniel", lastName: "Sample", fullName: "Daniel Sample", email: "dan@example.com" };
  assert.equal(wfMatch({ me, webformsUserName: "Dan Sample", webformsUserEmail: "dan@example.com" }), "same");
  assert.equal(wfMatch({ me, webformsUserName: "Dan Sample Personal Real Estate Corporation", webformsUserEmail: "corp@example.com" }), "own-corp");
  assert.equal(wfMatch({ me, webformsUserName: "Riley Example", webformsUserEmail: "riley@example.com" }), "different");
  assert.equal(wfMatch({ me, webformsUserName: "Dan Sample", webformsUserEmail: null }), "unknown");
  assert.equal(wfMatch({ me }), "none");
});

test("successful drafts are tallied per day and version, and sent when the day moves on", () => {
  let { tally, due } = tallyOk(null, { day: "2026-10-26", version: "0.1.2", path: "panel", forms: 1 });
  assert.equal(due, null);
  ({ tally, due } = tallyOk(tally, { day: "2026-10-26", version: "0.1.2", path: "one-click", forms: 3 }));
  assert.equal(due, null);
  assert.deepEqual(tally.counts, { "one-click": 1, panel: 1 });
  assert.deepEqual(tally.forms, { "1": 1, "2-3": 1, "4+": 0 });
  assert.equal(tallyDue(tally, { day: "2026-10-26", version: "0.1.2" }), false);
  assert.equal(tallyDue(tally, { day: "2026-10-27", version: "0.1.2" }), true);
  const next = tallyOk(tally, { day: "2026-10-27", version: "0.1.2", path: "panel", forms: 5 });
  assert.equal(next.due, tally);
  assert.deepEqual(next.tally.counts, { "one-click": 0, panel: 1 });
  const r = okReport({ version: "0.1.2", chrome: "141", ...next.due });
  assert.deepEqual(r, { v: 1, kind: "ok", version: "0.1.2", chrome: "141", day: "2026-10-26",
    counts: { "one-click": 1, panel: 1 }, forms: { "1": 1, "2-3": 1, "4+": 0 } });
});

test("the only request that leaves for anywhere but Real Signature and WEBForms is post(), with a sanitized report", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]))
    .filter((f) => f.endsWith(".js"));
  const net = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|EventSource/;
  for (const f of files("src")) {
    const lines = readFileSync(f, "utf8").split("\n").filter((l) => net.test(l) && !/^\s*\/\//.test(l));
    const ok = { "src/lib/realsig-api.js": 1, "src/lib/webforms-api.js": 1, "src/background.js": 1 };
    if (!ok[f]) assert.deepEqual(lines, [], `${f} makes a network request`);
  }
  const bg = readFileSync("src/background.js", "utf8");
  assert.equal((bg.match(/\bfetch\s*\(/g) || []).length, 1, "background.js has one fetch, in post()");
  assert.match(bg, /fetch\(REPORT_URL,/);
  // Every post() gets a report straight out of report.js (or the stored one it made).
  for (const call of bg.match(/\bpost\([^)]*\)?/g).filter((c) => !c.startsWith("post(report) {"))) {
    assert.match(call, /^post\((report|okReport\(|l\.report)/, call);
  }
});

test("Chrome's major version only", () => {
  assert.equal(chromeMajor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36"), "141");
  assert.equal(chromeMajor("curl/8"), null);
});
