// Error reports and draft counts for the Dotted Line team, sent only with the agent's yes
// (Dan, 2026-10-26). A 400 from Real Signature (the 70-character email subject) only
// reached us because a tester sent a screenshot; this is so the next one doesn't need one.
//
// WHAT MAY LEAVE THE BROWSER IS DECIDED HERE, AND ONLY HERE. Every field is a fixed choice
// (an enum), a number, or a short string that has to match a tight pattern. Nothing is
// passed through as text: Real's error messages can quote the value they refused (an
// address in a subject line), file names carry client names, and our own messages name
// forms and templates. sanitizeReport() rebuilds the report from scratch out of the fields
// below; anything that doesn't fit is dropped or becomes "other". test/report.test.js
// feeds it client details and fails if any come out.
//
// The receiving end (dealdates.app /api/dl-report) checks the same rules again on its own.

import { wfMatch, isOthersDeal } from "./actor.js";
import { signersWithoutEmail } from "./draft.js";

export const REPORT_URL ="https://dealdates.app/api/dl-report";

// The master switch. 0.1.1 shipped with it off while the receiving end was set up; on since
// that went live (dealdates.app/api/dl-report, 2026-10-27). Off: nothing is sent, the panel
// doesn't ask, Settings doesn't offer them, and "Send this error" never appears. Changing
// it changes the store listing's data-use answers too (store/listing.md).
export const REPORTS_ON = true;
export const SCHEMA = 1;

export const ENUMS = {
  kind: ["error", "ok"],
  // Where it failed: the WEBForms → Real Signature hand-off, loading deals and templates,
  // Finish draft in the panel, or the one-click draft.
  step: ["handoff", "context", "create", "one-click"],
  // What kind of failure. The receiving end alerts on some and only logs others (signed-out
  // and network are the agent's connection, not a bug).
  cls: ["signed-out", "network", "rejected", "forbidden", "not-found", "real-server", "changed-shape", "interrupted", "ours"],
  // Our own messages, by what they mean (the text itself names forms and templates).
  code: ["not-pdf", "fillable-pdf", "handoff-expired", "stale-tab", "deal-gone", "template-missing",
    "acting-no-deals", "page-count", "same-signer", "block-off-page", "zip", "duplicate-names",
    "no-forms", "refused-route", "changed-shape", "http", "unknown"],
  site: ["real-signature", "webforms", "none"],
  err: ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "DOMException", "NotSignedIn", "other"],
  path: ["one-click", "panel"],
  wf: ["same", "own-corp", "different", "unknown", "none"],
  deal: ["address", "name", "picked", "none"],
  tpl: ["all", "some", "none"],
  pages: ["agree", "differ", "unknown", "none"],
  forms: ["1", "2-3", "4+"],
  signers: ["0", "1", "2", "3+"],
  slow: ["none", "realSignatureReady", "pdfDownload", "upload", "readBack", "save", "packet", "draftMade"],
};

const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const CHROME = /^\d{2,3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// "PUT /document-templates/{id}": a method and up to 6 path words, every id blanked.
const ROUTE = /^(GET|PUT|POST|DELETE) (\/(\{id\}|[A-Za-z][A-Za-z-]{0,40})){1,6}$/;
// "defaults.signees[n].email": a schema path, no spaces, no @, no digits except [n].
const FIELD = /^[A-Za-z][A-Za-z_]{0,40}(\[n\])?(\.[A-Za-z][A-Za-z_]{0,40}(\[n\])?){0,5}$/;
const RULE = /^(size \d{1,5}-\d{1,5}|not-null|not-blank|not-empty|email|pattern|range|other)$/;

const pick = (v, list, fallback = undefined) => (list.includes(v) ? v : fallback);
const count = (n) => (Number.isInteger(n) && n >= 0 && n <= 1e6 ? n : 0);

// ---- reading an error ----

const OUR_CODES = [
  [/didn't come back as a PDF/, "not-pdf"],
  [/came back as a fillable PDF/, "fillable-pdf"],
  [/hand-off has expired/, "handoff-expired"],
  [/Reload (this|your Real Signature) tab once/, "stale-tab"],
  [/no longer in your open deals/, "deal-gone"],
  [/Pick a template \(or none\)/, "template-missing"],
  [/Couldn't find the agent you're acting for/, "acting-no-deals"],
  [/page count differs|couldn't read how many pages/, "page-count"],
  [/two roles are set to the same signer/, "same-signer"],
  [/block (is on|on) page/, "block-off-page"],
  [/two files named|Two of the picked forms are named/, "duplicate-names"],
  [/zip/i, "zip"],
  [/no forms picked/, "no-forms"],
  [/^refused:/, "refused-route"],
  [/changed shape/, "changed-shape"],
];

// The words in the routes this extension calls (realsig-api.js, webforms-api.js). Any other
// path segment is an id — or could be a name — and is blanked.
const ROUTE_WORDS = new Set([
  "document-templates", "packet-templates", "users", "me", "keymaker", "myself", "transactions",
  "participant", "listing-transactions", "OPEN", "buyer-record", "api", "systems",
  "GetPopulatedGlobalJson", "Basic", "transactioncontacts", "index", "forms", "single",
  "formeditor", "formfields", "Transfer", "CreateDownloadRequest", "downloadmany",
]);

/** "/document-templates/ec2d…" → "/document-templates/{id}". */
export function routeShape(method, path) {
  const segs = String(path).split("?")[0].split("/").filter(Boolean).slice(0, 6)
    .map((s) => (ROUTE_WORDS.has(s) ? s : "{id}"));
  const r = `${String(method).toUpperCase()} /${segs.join("/")}`;
  return ROUTE.test(r) ? r : null;
}

/** Real's validation text → {field, rule}, never the text itself. Spring's messages look
 *  like "defaults.emailSubject: size must be between 0 and 70". */
export function validationShape(why) {
  const first = String(why || "").split(/[;,]\s*(?=[A-Za-z][\w.[\]]*:\s)/)[0];
  const m = /^([A-Za-z][\w.[\]]{0,120}):\s+(.*)$/.exec(first);
  const field = m ? m[1].replace(/\[\d+\]/g, "[n]") : null;
  const text = m ? m[2] : first;
  const size = /size must be between (\d{1,5}) and (\d{1,5})/.exec(text);
  const rule = size ? `size ${size[1]}-${size[2]}`
    : /must not be null/.test(text) ? "not-null"
    : /must not be blank/.test(text) ? "not-blank"
    : /must not be empty/.test(text) ? "not-empty"
    : /well-formed email/.test(text) ? "email"
    : /must match/.test(text) ? "pattern"
    : /must be (less|greater) than/.test(text) ? "range"
    : m ? "other" : null;
  return { field: field && FIELD.test(field) ? field : null, rule };
}

/** An error (or its message, as it arrives from a content script) → the report's error
 *  fields. Classification only: nothing of the message is kept. */
export function classifyError(error) {
  const message = String(error?.message ?? error ?? "");
  const name = error?.name || "Error";
  const out = { cls: "ours", code: "unknown", site: "none", status: null, route: null, field: null, rule: null,
    err: pick(name, ENUMS.err, "other"), partial: /half-made/.test(message) };
  for (const [re, code] of OUR_CODES) if (re.test(message)) { out.code = code; break; }

  // Real Signature / reZEN: "PUT /document-templates/{uuid} → 400: field: rule…"
  const rs = /\b(GET|PUT|POST|DELETE) (\/\S*) → (\d{3})(?:: (.*))?/.exec(message);
  // WEBForms: "WEBForms answered 500 to GET /path"
  const wf = /WEBForms answered (\d{3}) to (GET|PUT|POST|DELETE) (\/\S*)/.exec(message);
  if (rs || wf) {
    const [method, path, status, why] = rs ? [rs[1], rs[2], rs[3], rs[4]] : [wf[2], wf[3], wf[1], ""];
    out.site = rs ? "real-signature" : "webforms";
    out.status = Number(status);
    out.route = routeShape(method, path);
    out.code = "http";
    Object.assign(out, validationShape(why));
    out.cls = out.status === 401 ? "signed-out" : out.status === 403 ? "forbidden" : out.status === 404 ? "not-found"
      : out.status >= 500 ? "real-server" : "rejected";
  } else if (name === "NotSignedIn" || /sign-in expired|Not signed in|Sign in to Real Signature|Open Real Signature in a tab first/i.test(message)) {
    out.cls = "signed-out";
  } else if (/Failed to fetch|NetworkError|Load failed|network error|ERR_INTERNET|ERR_NETWORK/i.test(message)) {
    out.cls = "network";
  } else if (out.code === "changed-shape") {
    out.cls = "changed-shape";
  } else if (out.code === "stale-tab" || out.code === "handoff-expired") {
    out.cls = "interrupted";
  }
  return out;
}

// ---- the draft around it ----

const band = (n, bands) => bands.find(([max]) => n <= max)?.[1] ?? bands.at(-1)[1];
export const formsBand = (n) => band(n, [[1, "1"], [3, "2-3"], [Infinity, "4+"]]);
export const signersBand = (n) => band(n, [[0, "0"], [1, "1"], [2, "2"], [Infinity, "3+"]]);

/** The step that took longest, if any took over 30 s. Timings are seconds per step. */
export function slowStep(timings = {}) {
  let worst = "none", most = 30;
  for (const [k, v] of Object.entries(timings || {})) {
    if (ENUMS.slow.includes(k) && typeof v === "number" && v > most) { worst = k; most = v; }
  }
  return worst;
}

/** What the draft looked like, as categories. Everything the panel and one-click already
 *  know; nothing about the deal itself.
 *  forms: [{pageCount}], templates: the chosen template per form ({pagesCount} or null). */
export function draftContext({ path, acting = false, wf = "none", dealBy = "none", othersDeal = false,
  forms = [], templates = [], signers = 0, noEmail = false, timings = {}, warned = false }) {
  const chosen = templates.filter(Boolean);
  const withTpl = forms.map((f, i) => (templates[i] ? [f?.pageCount, templates[i].pagesCount] : null)).filter(Boolean);
  const pages = !withTpl.length ? "none"
    : withTpl.some(([a, b]) => a && b && a !== b) ? "differ"
    : withTpl.some(([a, b]) => !a || !b) ? "unknown" : "agree";
  return {
    path, acting: !!acting, wf, deal: dealBy, othersDeal: !!othersDeal,
    tpl: !chosen.length ? "none" : chosen.length === forms.length ? "all" : "some",
    pages, forms: formsBand(forms.length || 1), signers: signersBand(signers),
    noEmail: !!noEmail, slow: slowStep(timings), warned: !!warned,
  };
}

/** draftContext from what the panel and one-click hold: c = rs:context's answer (me, deals,
 *  templates), job = the hand-off without PDFs, and the choices made. Any of them may be
 *  missing — a failure while loading has no choices yet. */
export function contextFromDraft({ path, c = null, job = null, dealId = null, dealBy = null, templateIds = [],
  counts = null, timings = {}, warned = false }) {
  const me = c?.me || null;
  const deal = (dealId && c?.deals?.find((d) => d.id === dealId)) || null;
  const n = counts || { BUYER: 0, SELLER: 0 };
  return draftContext({
    path,
    acting: !!me?.actingForAgent,
    wf: job ? wfMatch({ me, webformsUserName: job.webformsUserName, webformsUserEmail: job.webformsUserEmail }) : "none",
    dealBy: !deal ? "none" : dealBy === "address" || dealBy === "name" ? dealBy : "picked",
    othersDeal: isOthersDeal(me, deal),
    forms: job?.forms || [],
    templates: (job?.forms || []).map((_, i) => (templateIds[i] && c?.templates?.find((t) => t.id === templateIds[i])) || null),
    signers: (n.BUYER || 0) + (n.SELLER || 0),
    noEmail: deal ? signersWithoutEmail(deal, n).length > 0 : false,
    timings, warned,
  });
}

// ---- the reports themselves ----

/** Rebuilds a report from the allowed fields only. Use on everything before it is sent. */
export function sanitizeReport(r) {
  if (!r || typeof r !== "object") return null;
  const kind = pick(r.kind, ENUMS.kind);
  if (!kind) return null;
  const out = { v: SCHEMA, kind,
    version: VERSION.test(r.version) ? r.version : "0.0.0",
    chrome: CHROME.test(String(r.chrome)) ? String(r.chrome) : null };
  if (kind === "ok") {
    out.day = DAY.test(r.day) ? r.day : null;
    out.counts = { "one-click": count(r.counts?.["one-click"]), panel: count(r.counts?.panel) };
    out.forms = Object.fromEntries(ENUMS.forms.map((b) => [b, count(r.forms?.[b])]));
    return out;
  }
  Object.assign(out, {
    step: pick(r.step, ENUMS.step, null),
    cls: pick(r.cls, ENUMS.cls, "ours"),
    code: pick(r.code, ENUMS.code, "unknown"),
    site: pick(r.site, ENUMS.site, "none"),
    err: pick(r.err, ENUMS.err, "other"),
    status: Number.isInteger(r.status) && r.status >= 100 && r.status <= 599 ? r.status : null,
    route: typeof r.route === "string" && ROUTE.test(r.route)
      && r.route.split(" ")[1].split("/").slice(1).every((s) => s === "{id}" || ROUTE_WORDS.has(s)) ? r.route : null,
    field: typeof r.field === "string" && FIELD.test(r.field) ? r.field : null,
    rule: typeof r.rule === "string" && RULE.test(r.rule) ? r.rule : null,
    partial: r.partial === true,
  });
  const c = r.ctx;
  if (c && typeof c === "object") {
    out.ctx = {
      path: pick(c.path, ENUMS.path, null),
      acting: c.acting === true,
      wf: pick(c.wf, ENUMS.wf, "none"),
      deal: pick(c.deal, ENUMS.deal, "none"),
      othersDeal: c.othersDeal === true,
      tpl: pick(c.tpl, ENUMS.tpl, "none"),
      pages: pick(c.pages, ENUMS.pages, "unknown"),
      forms: pick(c.forms, ENUMS.forms, "1"),
      signers: pick(c.signers, ENUMS.signers, "0"),
      noEmail: c.noEmail === true,
      slow: pick(c.slow, ENUMS.slow, "none"),
      warned: c.warned === true,
    };
  }
  if (r.local && typeof r.local === "object") out.local = { made: count(r.local.made), failed: count(r.local.failed) };
  return out;
}

export function errorReport({ error, step, ctx = null, version, chrome, local = null }) {
  return sanitizeReport({ kind: "error", step, version, chrome, ctx, local, ...classifyError(error) });
}

/** Two error reports are the same failure only when EVERY field matches — the error and
 *  the draft around it (deal match, forms, signers, acting…), the version and Chrome — all
 *  but the browser's running totals, which change with every error. Six error fields used
 *  to decide it, so a different draft failing the same way was taken for a repeat and not
 *  reported (Dan, 2026-10-27). Both are sanitizeReport() output, so key order is fixed. */
export function sameFailure(a, b) {
  if (!a || !b) return false;
  const { local: _a, ...x } = a;
  const { local: _b, ...y } = b;
  return JSON.stringify(x) === JSON.stringify(y);
}

/** One day's successful drafts for one version, counted in this browser. */
export function okReport({ version, chrome, day, counts, forms }) {
  return sanitizeReport({ kind: "ok", version, chrome, day, counts, forms });
}

// ---- counting successful drafts: once a day, not once a draft ----
// Per draft would say when each draft was made; a day's total says how many worked, which
// is the point. The tally lives in this browser's storage and goes when the day (or the
// version) has moved on.

const emptyTally = (day, version) => ({ day, version, counts: { "one-click": 0, panel: 0 }, forms: { "1": 0, "2-3": 0, "4+": 0 } });

/** Is the tally from an earlier day or another version? Then it's ready to send. */
export function tallyDue(tally, { day, version }) {
  return !!tally && (tally.day !== day || tally.version !== version)
    && (tally.counts?.["one-click"] || 0) + (tally.counts?.panel || 0) > 0;
}

/** Adds one draft. → {tally, due}: due is the previous tally when it should go now. */
export function tallyOk(tally, { day, version, path, forms }) {
  const due = tallyDue(tally, { day, version }) ? tally : null;
  const next = tally && tally.day === day && tally.version === version ? structuredClone(tally) : emptyTally(day, version);
  if (ENUMS.path.includes(path)) next.counts[path] += 1;
  next.forms[formsBand(forms || 1)] += 1;
  return { tally: next, due };
}

/** "Chrome/141.0.7390.54" → "141". */
export function chromeMajor(ua) {
  return /Chrome\/(\d{2,3})\./.exec(String(ua || ""))?.[1] || null;
}
