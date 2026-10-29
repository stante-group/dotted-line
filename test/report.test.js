import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, errorReport, labelsReport, okReport, sanitizeReport, draftContext, routeShape, validationShape,
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
    labels: "none", pages: "unknown", forms: "4+", signers: "0", noEmail: false, slow: "upload", warned: false, form: null });
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
    tpl: "all", labels: "none", pages: "differ", forms: "2-3", signers: "3+", noEmail: true, slow: "save", warned: true });
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
  assert.deepEqual(tally.counts, { "one-click": 1, panel: 1, labels: 0 });
  assert.deepEqual(tally.forms, { "1": 1, "2-3": 1, "4+": 0 });
  assert.equal(tallyDue(tally, { day: "2026-10-26", version: "0.1.2" }), false);
  assert.equal(tallyDue(tally, { day: "2026-10-27", version: "0.1.2" }), true);
  const next = tallyOk(tally, { day: "2026-10-27", version: "0.1.2", path: "panel", forms: 5 });
  assert.equal(next.due, tally);
  assert.deepEqual(next.tally.counts, { "one-click": 0, panel: 1, labels: 0 });
  const r = okReport({ version: "0.1.2", chrome: "141", ...next.due });
  assert.deepEqual(r, { v: 1, kind: "ok", version: "0.1.2", chrome: "141", day: "2026-10-26",
    counts: { "one-click": 1, panel: 1, labels: 0 }, forms: { "1": 1, "2-3": 1, "4+": 0 } });
  // A draft with a form placed from its labels counts once more, under labels.
  const l = tallyOk(null, { day: "2026-10-26", version: "0.1.2", path: "one-click", forms: 2, labels: true });
  assert.deepEqual(l.tally.counts, { "one-click": 1, panel: 0, labels: 1 });
  // A tally stored before labels existed still adds up.
  const old = { day: "2026-10-26", version: "0.1.2", counts: { "one-click": 2, panel: 0 }, forms: { "1": 2, "2-3": 0, "4+": 0 } };
  assert.equal(tallyOk(old, { day: "2026-10-26", version: "0.1.2", path: "panel", forms: 1, labels: true }).tally.counts.labels, 1);
});

test("a form placed from its labels with no blocks: the reason and the form's library code, nothing typed on it", () => {
  const r = labelsReport({ code: "no-labels", form: "AREA0287", path: "one-click", version: "0.1.2", chrome: "141" });
  assert.equal(r.step, "labels");
  assert.equal(r.code, "no-labels");
  assert.equal(r.ctx.form, "AREA0287");
  assert.equal(r.ctx.path, "one-click");
  // A form name, a file name or anything typed is not a library code, and is left out.
  for (const form of ["Jordan Sample Offer", "120 Example Street NW.pdf", "area0287", "AREA0287 Jordan", "A1234567X Sample"]) {
    const x = labelsReport({ code: "fonts", form, path: "panel", version: "0.1.2", chrome: "141" });
    assert.equal(x.ctx.form, null, form);
    assert.deepEqual(leaks(x), []);
  }
  assert.equal(labelsReport({ code: "Jordan Sample", form: null, path: "panel", version: "0.1.2" }).code, "unknown");
});

test("No deal as the default is told apart from No deal picked", async () => {
  const { contextFromDraft } = await import("../src/lib/report.js");
  assert.equal(contextFromDraft({ path: "one-click", dealBy: "none" }).deal, "none-default");
  assert.equal(contextFromDraft({ path: "panel", dealBy: null }).deal, "none");
  assert.equal(contextFromDraft({ path: "panel", job: { forms: [{}, {}] }, templateIds: ["auto", "t1"] }).labels, "some");
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
    assert.match(call, /^post\((report|okReport\(|labelsReport\(|l\.report)/, call);
  }
});

test("each job:/report: message is sent only from the context the worker accepts it from", async () => {
  // background.js answers job:get / job:status only from a Real Signature tab (job:get
  // hands over the PDFs) and every other job:/report: message only from the extension's
  // own pages. A sender moved to the wrong file would be silently ignored.
  const { readFileSync } = await import("node:fs");
  const bg = readFileSync("src/background.js", "utf8");
  const rsOnly = JSON.parse(`[${/RS_TAB_ONLY = new Set\(\[([^\]]*)\]\)/.exec(bg)[1]}]`);
  const sent = (f) => [...readFileSync(f, "utf8").matchAll(/sendMessage\(\{ type: "((?:job|report):[\w-]+)"/g)].map((m) => m[1]);
  for (const t of sent("src/realsig/content.js")) assert.ok(rsOnly.includes(t), `${t} from the Real Signature tab`);
  for (const f of ["src/panel/panel.js", "src/options/options.js", "src/options/import.js"]) {
    for (const t of sent(f)) assert.ok(!rsOnly.includes(t), `${t} from ${f}`);
  }
  assert.deepEqual(sent("src/webforms/content.js"), [], "WEBForms tab sends no job:/report: message");
  assert.ok(rsOnly.includes("job:get"));
});

test("Import templates: only Real Signature's refusal is reported, as its route and rule", () => {
  const refused = errorReport({ error: new Error("PUT /document-templates/ec2d0000-1111-2222-3333-444455556666 → 400: fieldDefinitions[3].fieldLocations: must not be empty"), step: "import", version: "0.2.1", chrome: "141" });
  assert.equal(refused.step, "import");
  assert.equal(refused.route, "PUT /document-templates/{id}");
  assert.equal(refused.field, "fieldDefinitions[n].fieldLocations");
  // A file that won't read isn't Real Signature's answer: import.js doesn't send it at all.
  assert.notEqual(classifyError(new Error("Jordan Sample offer.json isn't a template file")).site, "real-signature");
});

test("Chrome's major version only", () => {
  assert.equal(chromeMajor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36"), "141");
  assert.equal(chromeMajor("curl/8"), null);
});

test("one switch turns reports off everywhere: nothing posted, nothing offered", async () => {
  const { readFile } = await import("node:fs/promises");
  const { REPORTS_ON } = await import("../src/lib/report.js");
  // On since the endpoint went live (2026-10-27). Flipping it is a release decision: the
  // store listing's data-use answers change with it (store/listing.md).
  assert.equal(REPORTS_ON, true);
  const bg = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(bg, /async function post\(report\) \{\n  if \(!REPORTS_ON\) return false;/);
  assert.match(bg, /"report:last"\) \{\n      if \(!REPORTS_ON\) return null;/);
  const panel = await readFile(new URL("../src/panel/panel.js", import.meta.url), "utf8");
  assert.match(panel, /\$\("consent"\)\.hidden = !REPORTS_ON/);
  const opts = await readFile(new URL("../src/options/options.js", import.meta.url), "utf8");
  assert.match(opts, /\$\("reporting-wrap"\)\.hidden = !REPORTS_ON/);
});

test("a failure reading the WEBForms page is reported, as the hand-off step", async () => {
  const { readFile } = await import("node:fs/promises");
  const panel = await readFile(new URL("../src/panel/panel.js", import.meta.url), "utf8");
  assert.match(panel, /await showWebforms\(tab\)\.catch\(async \(e\) => \{ await reportError\(e, "handoff"\); throw e; \}\)/);
});


test("a repeat is the same failure in every field, not six of them", async () => {
  const { sameFailure } = await import("../src/lib/report.js");
  const err = { message: "Reload this tab once (the extension was installed or updated after it opened).", name: "Error" };
  const base = { error: err, step: "context", version: "0.1.2", chrome: "141" };
  const a = errorReport({ ...base, ctx: draftContext({ path: "panel", forms: [{}], signers: 2 }), local: { made: 2, failed: 1 } });
  const sameAgain = errorReport({ ...base, ctx: draftContext({ path: "panel", forms: [{}], signers: 2 }), local: { made: 2, failed: 2 } });
  const otherDraft = errorReport({ ...base, ctx: draftContext({ path: "panel", forms: [{}, {}, {}, {}], signers: 2 }), local: { made: 2, failed: 2 } });
  const otherVersion = errorReport({ ...base, version: "0.1.3", ctx: draftContext({ path: "panel", forms: [{}], signers: 2 }) });
  assert.ok(sameFailure(a, sameAgain), "only the running totals differ");
  assert.ok(!sameFailure(a, otherDraft), "4 forms instead of 1 is a different failure");
  assert.ok(!sameFailure(a, otherVersion));
  assert.ok(!sameFailure(a, null));
  const { readFile } = await import("node:fs/promises");
  const bg = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  assert.ok(!/\["step", "cls", "code", "route", "field", "rule"\]\.every/.test(bg), "the six-field test is gone");
  assert.match(bg, /sameFailure\(lastReport\.report, report\)/);
});

test("the report and its Send button sit inside the error's red box", async () => {
  const { readFile } = await import("node:fs/promises");
  const panel = await readFile(new URL("../src/panel/panel.js", import.meta.url), "utf8");
  assert.match(panel, /function reportHost\(\)/);
  assert.match(panel, /box = el\("div", "", "report-in-err"\);\n    host\.append\(box\);/);
  const html = await readFile(new URL("../src/panel/panel.html", import.meta.url), "utf8");
  assert.match(html, /\.report-in-err \{/);
});

test("every panel error path reports once: the WEBForms button, an Acting-as reload, any redraw", async () => {
  const { readFile } = await import("node:fs/promises");
  const panel = await readFile(new URL("../src/panel/panel.js", import.meta.url), "utf8");
  assert.match(panel, /async function reportError\(e, step, draft = \{\}\) \{\n[^\n]*\n  try \{ if \(e && typeof e === "object"\) e\.reported = true;/);
  assert.match(panel, /if \(e\?\.reported\) showReport\(\)\.catch\(\(\) => \{\}\);\n    else await reportError\(e, "handoff"\);/);
  assert.match(panel, /showRealsig\(rsState\.tab, job\)\.catch\(async \(e\) => \{[\s\S]{0,120}if \(!e\?\.reported\) await reportError\(e, "context", \{ job \}\);/);
  assert.match(panel, /if \(!e\?\.reported\) await reportError\(e, "context"\);\n    \} finally \{\n      refreshing = null;/);
  assert.ok(!/\.catch\(\(e\) => say\(String\(e\.message \|\| e\), "err"\)\)/.test(panel), "no error shown without being reported");
});

// The real background worker, with a fake chrome whose storage round-trips through JSON and
// a counted fetch: one failure must never become two reports (Dan's test, 2026-10-27).
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

async function backgroundWorker() {
  const store = {}, changed = [], onMsg = [];
  const ev = (arr) => ({ addListener: (f) => arr.push(f) });
  const any = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : any), apply: () => Promise.resolve() });
  const local = {
    get: async (keys) => Object.fromEntries((keys == null ? Object.keys(store) : [].concat(keys)).filter((k) => k in store).map((k) => [k, JSON.parse(store[k])])),
    // Like Chrome's: objects come back with their keys in alphabetical order.
    set: async (o) => { for (const [k, v] of Object.entries(o)) store[k] = JSON.stringify(sortKeys(v)); changed.forEach((f) => f(o, "local")); },
    remove: async (k) => { for (const x of [].concat(k)) delete store[x]; },
  };
  globalThis.chrome = new Proxy({
    storage: { local, sync: { get: async () => ({}) }, onChanged: ev(changed) },
    runtime: { getManifest: () => ({ version: "0.1.2" }), getURL: (p) => "chrome-extension://x/" + (p || ""), onMessage: ev(onMsg), sendMessage: () => Promise.resolve(), onInstalled: ev([]) },
    tabs: { query: async () => [], onUpdated: ev([]), onActivated: ev([]), onRemoved: ev([]) },
  }, { get: (t, k) => (k in t ? t[k] : any) });
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Chrome/141.0.0.0" }, configurable: true });
  globalThis.indexedDB = { open: () => { const r = {}; setTimeout(() => r.onerror?.(), 0); return r; } };
  const sent = [];
  globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; };
  await import(`../src/background.js?${Math.random()}`);
  const ask = (msg) => new Promise((res) => { for (const f of onMsg) f(msg, { url: "chrome-extension://x/src/panel/panel.html" }, res); });
  return { store, local, sent, ask, settle: () => new Promise((r) => setTimeout(r, 20)) };
}

test("one failure is one report: repeats, and a switch from no to yes, don't send it twice", async () => {
  const { REPORTS_ON } = await import("../src/lib/report.js");
  if (!REPORTS_ON) return;
  const w = await backgroundWorker();
  const error = { message: "Reload this tab once (the extension was installed or updated after it opened).", name: "Error" };
  const fail = () => w.ask({ type: "report:error", step: "handoff", error, ctx: { path: "panel", forms: "1" } });

  // Yes: the same failure twice → sent once, the second counted as a repeat.
  await w.local.set({ reporting: "yes" });
  await fail(); await w.settle();
  const r = await fail(); await w.settle();
  assert.equal(w.sent.length, 1);
  assert.equal(r.repeat, true);

  // No, sent by hand, then yes, then the same failure → still that one report.
  w.sent.length = 0; await w.local.remove("lastReport");
  await w.local.set({ reporting: "no" });
  await fail(); await w.settle();
  const { lastReport } = await w.local.get("lastReport");
  await w.ask({ type: "report:send-last", at: lastReport.at }); await w.settle();
  await w.local.set({ reporting: "yes" });
  await fail(); await w.settle();
  assert.equal(w.sent.length, 1, "sent by hand, not again after the switch to yes");

  // No, not sent, then yes, then the same failure → it goes now, once.
  w.sent.length = 0; await w.local.remove("lastReport");
  await w.local.set({ reporting: "no" });
  await fail(); await w.settle();
  await w.local.set({ reporting: "yes" });
  await fail(); await w.settle();
  await fail(); await w.settle();
  assert.equal(w.sent.length, 1, "the unsent first report goes once the answer is yes");
});

test("a failure that never saw the ticked forms says the count is unknown, not 1", async () => {
  const { contextFromDraft, sanitizeReport } = await import("../src/lib/report.js");
  assert.equal(contextFromDraft({ path: "panel" }).forms, "unknown");
  assert.equal(contextFromDraft({ path: "panel", job: { forms: [{}, {}] } }).forms, "2-3");
  const base = { kind: "error", version: "0.1.2", chrome: "141", step: "handoff" };
  assert.equal(sanitizeReport({ ...base, ctx: { path: "panel", forms: "unknown" } }).ctx.forms, "unknown");
  assert.equal(sanitizeReport({ ...base, ctx: { path: "panel", forms: "1" } }).ctx.forms, "1");
  assert.equal(sanitizeReport({ ...base, ctx: { path: "panel", forms: "7 forms" } }).ctx.forms, "unknown");
  assert.equal(sanitizeReport({ kind: "ok", version: "0.1.2", day: "2026-10-28", forms: { unknown: 3 } }).forms.unknown, undefined);
});
