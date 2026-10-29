// Service worker: holds a hand-off "job" (the PDFs plus what the agent chose) between the
// WEBForms tab and the Real Signature tab. The forms never leave the browser except into
// the agent's own Real Signature account. The only other thing that can leave is an error
// report or a day's draft count, built by src/lib/report.js, and only if the agent said yes.
//
// Jobs live in the extension's own IndexedDB, are deleted once the draft is made, and
// anything older than JOB_TTL_MS is purged on startup — contracts must not linger.

import { planDraft, madeSummary } from "./lib/auto.js";
import { DEFAULT_SETTINGS, subjectFor } from "./lib/pattern.js";
import { subjectTooLong } from "./lib/draft.js";
import { sendToTab } from "./messaging.js";
import { unzip } from "./lib/unzip.js";
import { isPdf, hasAcroForm, countPages, fromBase64, toBase64 } from "./lib/pdf.js";
import { pairEntries, zipBatches } from "./lib/webforms-api.js";
import { readPdfText } from "./lib/pdftext.js";
import { autoLayout, placedSummary, placeOutcome } from "./lib/autoplace.js";
import { errorReport, labelsReport, okReport, sanitizeReport, tallyOk, tallyDue, contextFromDraft, draftContext, chromeMajor, REPORT_URL, REPORTS_ON, sameFailure } from "./lib/report.js";

const DB = "wfrs";
const STORE = "jobs";
const JOB_TTL_MS = 60 * 60 * 1000;

// Where the UI shows (2026-10-12). A side panel always narrows the page beside it, and
// WEBForms with its own right-hand menu open gets cramped; Dotted Line may not change
// WEBForms' page (PLAN.md rule 3), so it can't collapse that menu or float over it.
// So: the icon opens a POPUP over the page everywhere except Real Signature, where the
// deal / signer / template choices need room and the SIDE PANEL opens — enabled on Real
// Signature tabs only, so switching back to WEBForms never squeezes it.
const RS = "https://signature.therealbrokerage.com/";
const PANEL = "src/panel/panel.html";
const POPUP = "src/panel/panel.html?popup=1";
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
chrome.action.setPopup({ popup: POPUP }).catch(() => {});
// The icon is live on WEBForms and Real Signature only, greyed (disabled) everywhere else
// (Dan, 2026-10-15): on other sites the popup only said "open WEBForms", and a blue icon
// suggested it would do something there. Disabled by default; placeUi turns it on per tab.
// Settings stays in the icon's right-click menu (Options) on every site.
chrome.action.disable().catch(() => {});
const WF = "https://pr.transactiondesk.com/";

async function placeUi(tabId, url) {
  const u = String(url || "");
  const rs = u.startsWith(RS);
  // Without the "tabs" permission Chrome only gives us the URL of our two sites; any other
  // tab's url is undefined, which correctly reads as "not ours".
  await (rs || u.startsWith(WF) ? chrome.action.enable(tabId) : chrome.action.disable(tabId)).catch(() => {});
  await chrome.action.setPopup({ tabId, popup: rs ? "" : POPUP }).catch(() => {});
  await chrome.sidePanel.setOptions(rs ? { tabId, path: PANEL, enabled: true } : { tabId, enabled: false }).catch(() => {});
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "loading") placeUi(tabId, tab.url);
  if (info.url || info.status === "complete") madeBadge(tabId, tab.url).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => forgetMade(tabId).catch(() => {}));

// What one click chose, per Real Signature tab (auto.js madeSummary): the panel shows it
// when the icon is clicked on that draft. Session storage: gone when Chrome closes, and
// never in a report. Kept while the tab is on that draft (its id in the URL).
// When one click chose for the agent, the icon gets a small amber dot, like an app's
// notification dot — informational, so not a badge (Chrome's are boxes, and read as
// alarms; Dan, 2026-10-29). The dot goes once the panel has shown the summary, or the
// agent moves on from the draft's first step (Next, or any change of address): by then
// they've looked at the page the dot is about.
const draftKey = (url) => String(url).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || String(url);
// Paths from the extension's root ("/icons/…"): a relative one is read from where THIS
// script is, src/, and src/icons/ doesn't exist — the dot never showed, silently (Dan's
// test 26, 2026-10-29).
const fromRoot = (paths) => Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, `/${String(v).replace(/^\//, "")}`]));
const ICON = fromRoot(chrome.runtime.getManifest().action?.default_icon || {});
const DOT_ICON = { 16: "/icons/toolbar-dot-16.png", 32: "/icons/toolbar-dot-32.png" };
const iconFailed = (e) => console.warn("Dotted Line: couldn't set the toolbar icon", e);
async function showMade(tabId, made) {
  const { madeFor = {} } = await chrome.storage.session.get("madeFor");
  await chrome.storage.session.set({ madeFor: { ...madeFor, [tabId]: { ...made, at: Date.now() } } });
  await madeBadge(tabId, null);
}
async function setMade(tabId, patch) {
  const { madeFor = {} } = await chrome.storage.session.get("madeFor");
  if (!madeFor[tabId]) return null;
  const next = { ...madeFor[tabId], ...patch };
  await chrome.storage.session.set({ madeFor: { ...madeFor, [tabId]: next } });
  return next;
}
// The manifest's icon and title again: a tab's own can't be unset, only replaced.
async function clearMadeBadge(tabId) {
  await chrome.action.setIcon({ tabId, path: ICON }).catch(iconFailed);
  await chrome.action.setTitle({ tabId, title: chrome.runtime.getManifest().action?.default_title || "Dotted Line" }).catch(() => {});
}
async function forgetMade(tabId) {
  const { madeFor = {} } = await chrome.storage.session.get("madeFor");
  if (!madeFor[tabId]) return;
  delete madeFor[tabId];
  await chrome.storage.session.set({ madeFor });
}
/** The dot's done its job: the summary stays, the dot goes. */
async function madeSeen(tabId) {
  const made = await setMade(tabId, { seen: true });
  if (made) await clearMadeBadge(tabId);
}
async function madeBadge(tabId, url) {
  const { madeFor = {} } = await chrome.storage.session.get("madeFor");
  let made = madeFor[tabId];
  if (!made) return;
  // Only once the tab has been seen ON the draft does leaving it count. Straight after the
  // switch Chrome still reports the page it came from, and judging by that threw every
  // summary away before anyone could see it (Dan's test 23, 2026-10-29).
  const here = url && String(url).includes(made.draft);
  if (here && !made.arrived) {
    made = await setMade(tabId, { arrived: String(url) });
  } else if (url && !here && made.arrived) {
    await forgetMade(tabId);
    await clearMadeBadge(tabId);
    return;
  } else if (here && String(url) !== made.arrived && !made.seen) {
    await madeSeen(tabId); // a later step of the same draft
    return;
  }
  if (!made?.guessed || made.seen) return;
  const chose = [!made.deal && "No deal", made.forms.some((f) => f.how === "labels" && !f.chosen) && "blocks from the form's labels"].filter(Boolean).join(" and ");
  await chrome.action.setIcon({ tabId, path: DOT_ICON }).catch(iconFailed);
  await chrome.action.setTitle({ tabId, title: `Dotted Line made this draft with ${chose}. Click to see what it chose.` }).catch(() => {});
}
chrome.tabs.query({}).then((tabs) => tabs.forEach((t) => placeUi(t.id, t.url))).catch(() => {});

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

async function purgeOld() {
  const cutoff = Date.now() - JOB_TTL_MS;
  await tx("readwrite", (s) => {
    s.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      if (c.value.createdAt < cutoff) c.delete();
      c.continue();
    };
  });
}
purgeOld().catch(() => {});

// ---- error reports and draft counts (src/lib/report.js; Dan, 2026-10-26) ----
// storage.local: reporting "yes" | "no" | unset (not asked yet — nothing is sent);
// draftStats {made, failed} in this browser, always kept, never sent on its own;
// okTally, today's successful drafts; lastReport {report, at, sent, auto}, for the panel's
// "Send this error": auto is true while an automatic send is on its way, and goes back to
// false if it fails, so the button is offered instead of a claim that it went.
const VERSION = chrome.runtime.getManifest().version;
const CHROME = chromeMajor(navigator.userAgent);
// The agent's own day, YYYY-MM-DD. Built by hand rather than from a locale's date format,
// which is locale data and not a promise (outside review, 2026-10-26).
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// One at a time: two drafts finishing together must not both read, add and write the tally.
let reportChain = Promise.resolve();
const serial = (f) => (reportChain = reportChain.then(f, f));

// The one door out. Everything goes through sanitizeReport HERE, at the last moment, so
// nothing added to a report after it was built (a stored copy, a field set later) can
// ride along (outside review, 2026-10-26).
async function post(report) {
  if (!REPORTS_ON) return false;
  const clean = sanitizeReport(report);
  if (!clean) return false;
  try {
    const r = await fetch(REPORT_URL, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean), credentials: "omit", signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch {
    return false; // a report that can't go is dropped, never retried into a pile
  }
}

function recordError({ error, step, ctx }) {
  return serial(async () => {
    const { draftStats = {}, reporting, lastReport } = await chrome.storage.local.get(["draftStats", "reporting", "lastReport"]);
    const stats = { made: draftStats.made || 0, failed: (draftStats.failed || 0) + 1 };
    const report = errorReport({ error, step, ctx, version: VERSION, chrome: CHROME, local: stats });
    // The same failure again within 10 minutes is one failure: the panel redraws on every
    // tab switch, and a Real Signature tab that can't load would report itself each time.
    // "Same" is every field (sameFailure), and the panel says it's a repeat (repeats) rather
    // than showing the first one's "sent" as if it were about this one.
    // A changed answer doesn't start fresh: forgetting the first report made the same
    // failure, sent by hand under "no", go again automatically after a switch to "yes" — one
    // failure, two reports (Dan's test, 2026-10-27). A repeat is never sent again. The one
    // case that sends is a first report that never went, now that the answer is yes.
    if (lastReport && Date.now() - lastReport.at < 10 * 60 * 1000 && sameFailure(lastReport.report, report)) {
      const late = reporting === "yes" && !lastReport.sent && !lastReport.auto;
      const l = { ...lastReport, repeats: (lastReport.repeats || 0) + 1, auto: lastReport.auto || late };
      await chrome.storage.local.set({ draftStats: stats, lastReport: l });
      if (late) {
        post(l.report).then(async (ok) => {
          const { lastReport: now } = await chrome.storage.local.get("lastReport");
          if (now?.at === l.at) await chrome.storage.local.set({ lastReport: { ...now, sent: ok, auto: ok } });
        }).catch(() => {});
      }
      return { auto: !!l.auto, reporting: reporting || null, repeat: true };
    }
    const at = Date.now();
    // auto: on its way because the agent said yes. The send itself is not awaited (up to
    // 8 s), so the agent sees the error at once. If it fails, auto goes back to false and
    // the panel offers the button rather than saying it went.
    const auto = REPORTS_ON && reporting === "yes";
    await chrome.storage.local.set({ draftStats: stats, lastReport: { report, at, sent: false, auto } });
    if (auto) {
      post(report).then(async (ok) => {
        const { lastReport: l } = await chrome.storage.local.get("lastReport");
        if (l?.at === at) await chrome.storage.local.set({ lastReport: { ...l, sent: ok, auto: ok } });
      }).catch(() => {});
    }
    return { auto, reporting: reporting || null };
  });
}

function recordOk({ path, forms, labels = false }) {
  return serial(async () => {
    const { draftStats = {}, okTally = null, reporting } = await chrome.storage.local.get(["draftStats", "okTally", "reporting"]);
    const { tally, due } = tallyOk(okTally, { day: today(), version: VERSION, path, forms, labels });
    await chrome.storage.local.set({ draftStats: { made: (draftStats.made || 0) + 1, failed: draftStats.failed || 0 }, okTally: tally });
    if (due && reporting === "yes") post(okReport({ chrome: CHROME, ...due })); // not awaited: see recordError
  });
}

// Forms placed from their labels that got no blocks (autoplace.js placeOutcome): the draft
// was made, so nothing showed, and only a report says which printed forms to work on next.
// Sent only with a yes, never offered as "Send this error" (the agent saw no error), and
// once a day per form and reason, so an agent using the same form all day sends one.
function recordLabels({ job, templateIds, path }) {
  return serial(async () => {
    const { reporting, labelsSent = {} } = await chrome.storage.local.get(["reporting", "labelsSent"]);
    if (!REPORTS_ON || reporting !== "yes") return;
    const day = today();
    const sent = Object.fromEntries(Object.entries(labelsSent).filter(([, d]) => d === day));
    for (const [i, f] of (job?.forms || []).entries()) {
      const code = templateIds[i] === "auto" ? f.placed?.outcome : null;
      if (!code) continue;
      const key = `${VERSION}|${f.library || "?"}|${code}`;
      if (sent[key]) continue;
      sent[key] = day;
      post(labelsReport({ code, form: f.library, path, version: VERSION, chrome: CHROME })); // not awaited: see recordError
    }
    await chrome.storage.local.set({ labelsSent: sent });
  });
}

// A day's count goes once the day is over: on the next draft, or here when the worker starts.
function flushOk() {
  return serial(async () => {
    const { okTally = null, reporting } = await chrome.storage.local.get(["okTally", "reporting"]);
    if (!tallyDue(okTally, { day: today(), version: VERSION })) return;
    await chrome.storage.local.set({ okTally: null });
    if (reporting === "yes") post(okReport({ chrome: CHROME, ...okTally }));
  });
}
flushOk().catch(() => {});

// Messages:
//   {type: "report:error", step, error: {message, name}, ctx} → {auto, reporting}
//   {type: "report:ok", path, forms}  → counted (and a past day's count sent, with a yes)
//   {type: "report:last"}             → the last error report from the past 10 minutes, or null
//   {type: "report:send-last", at}    → sends it: the agent pressed "Send this error" under
//       the report stamped `at`. Another error since then means another report: refused,
//       so the button never sends something other than what "What's sent" showed.
//   Who may send what: the job:get/job:status pair only from a Real Signature tab (job:get
//   hands over the PDFs), everything else only from the extension's own pages. Web pages
//   can't message us at all (no externally_connectable); this keeps each message to the
//   one part of the extension that uses it (outside review, 2026-10-26).
//   {type: "job:forTab", tabId}       → that tab's job without the PDFs (for the panel)
//   {type: "job:get", id}             → the whole job (for the Real Signature content script)
//   {type: "job:done", id}            → deletes it
//   {type: "job:start", wfTabId, wfForms, meta, background, auto}
//       → the whole hand-off from the WEBForms click: opens Real Signature, downloads the
//       forms, stores the job, and (auto) makes the draft → {id, tabId, auto} or
//       {error, tabId}. Here, not in the popup: Chrome closes a popup the moment the agent
//       clicks anything else — the Real Signature tab it opened included — and the hand-off
//       died with it, silently (Dan, 2026-10-15).
//   {type: "job:status"} (from a Real Signature tab) / {type: "job:pending", tabId} (from the
//       panel) → that tab's hand-off in progress, {busy} or {error}, or null
//   {type: "job:auto", id}            → one click: makes the draft if nothing needs the
//       agent and switches to it → {done: true}; else stores why on the job, for the
//       panel → {done: false, needs}
// The tab binding is stored IN the job, not in worker memory: MV3 stops idle workers, and
// a hand-off must survive the agent pausing to sign in to Real Signature.

async function allJobs() {
  return tx("readonly", (s) => s.getAll());
}

const withoutPdfs = (j) => j && { ...j, forms: j.forms.map(({ pdfBase64, ...f }) => f) };

// One click (src/lib/auto.js). Here rather than in the popup: the popup closes as soon as
// the agent clicks anywhere else, and this must finish what it starts — a draft made but
// not marked done would be offered again by the panel on that tab.
// Anything that stops it (not signed in, a choice to make, an error) leaves the job as it
// was, for the panel to take over with the reason on top. Nothing here sends.
// One run per job at a time (outside review, 2026-10-15): a second job:auto for the same
// hand-off while one is under way would make a second draft. Only one popup sends it today,
// once, but a duplicate costs nothing to refuse. In memory: if the worker restarts mid-run,
// that run is gone anyway and the panel takes over.
const autoRunning = new Set();
async function autoCreate(id) {
  if (autoRunning.has(id)) return { done: false, busy: true };
  autoRunning.add(id);
  try { return await autoCreateOnce(id); } finally { autoRunning.delete(id); }
}
async function autoCreateOnce(id) {
  const job = await tx("readonly", (s) => s.get(id));
  if (!job?.tabId) return { done: false };
  // needs: what the panel will ask for (it says so in each section itself); autoError: a
  // failed attempt, which the panel shows on top.
  const stop = async (needs, autoError = null) => {
    await tx("readwrite", (s) => s.put({ ...job, needs, autoError }));
    return { done: false, needs };
  };
  // Seconds per step, for "Check my setup" (numbers only — nothing about the deal).
  const t0 = Date.now();
  const timings = { ...(job.timings || {}) };
  const lap = (k, since) => { timings[k] = Math.round((Date.now() - since) / 100) / 10; };
  const keep = () => chrome.storage.local.set({ lastTimings: { at: Date.now(), job: id, forms: job.forms.length, ...timings } }).catch(() => {});
  let c = null, plan = null;
  try {
    c = await sendToTab(job.tabId, { type: "rs:context" });
    lap("realSignatureReady", t0);
    if (!c?.signedIn) return { done: false }; // the panel asks them to sign in
    const { templateFor = {}, agentMode = "one" } = await chrome.storage.local.get(["templateFor", "agentMode"]);
    plan = planDraft({ job: withoutPdfs(job), c, remembered: templateFor, agentMode });
    if (!plan.ready) { await keep(); return stop(plan.needs); }
    let settings = DEFAULT_SETTINGS;
    try { settings = { ...DEFAULT_SETTINGS, ...((await chrome.storage.sync.get("settings")).settings || {}) }; } catch { /* defaults */ }
    const emailSubject = subjectFor(settings, job.titleValues || {}, job.title);
    // Over Real's 70: the panel shows the subject for the agent to shorten, rather than
    // one click rewriting it unseen.
    if (subjectTooLong(emailSubject)) { await keep(); return stop(["The signers' email subject is over 70 characters."]); }
    const t1 = Date.now();
    const r = await sendToTab(job.tabId, {
      type: "rs:create", jobId: id, title: job.title, dealId: plan.dealId,
      templateIds: plan.templateIds, counts: plan.counts, agentChoice: plan.agentChoice,
      emailSubject,
    });
    lap("draftMade", t1);
    Object.assign(timings, r.timings || {});
    await tx("readwrite", (s) => s.delete(id));
    await chrome.tabs.update(job.tabId, { url: new URL(r.url, RS).toString(), active: true });
    await showMade(job.tabId, { ...madeSummary({ plan, job: withoutPdfs(job), c }), draft: draftKey(r.url) });
    lap("oneClickTotal", t0);
    await keep();
    const labels = plan.templateIds.includes("auto");
    recordOk({ path: "one-click", forms: job.forms.length, labels }).catch(() => {});
    if (labels) recordLabels({ job: withoutPdfs(job), templateIds: plan.templateIds, path: "one-click" }).catch(() => {});
    return { done: true, packet: !!r.packet };
  } catch (e) {
    // rs:create deletes its own half-made drafts before it throws.
    const why = `Couldn't make the draft in one click: ${String(e?.message || e)}`;
    await recordError({ error: e, step: "one-click", ctx: contextFromDraft({ path: "one-click", c: c?.signedIn ? c : null,
      job: withoutPdfs(job), dealId: plan?.dealId, dealBy: plan?.dealBy, templateIds: plan?.templateIds || [],
      counts: plan?.counts, timings }) }).catch(() => {});
    return stop([why], why);
  }
}

// From the popup the tab opens in the BACKGROUND: making it active would close the popup
// before it can open the side panel there (background = true).
async function openRealSignature(background) {
  const url = `${RS}home/draft`;
  const tab = await chrome.tabs.create({ url, active: !background });
  await placeUi(tab.id, url); // side panel enabled there before anyone opens it
  return tab.id;
}

// A hand-off under way, per Real Signature tab: {busy: text} or {error: text}. In memory —
// if the worker stops mid-way, that hand-off is gone anyway; the tab then says nothing,
// as before. Told to the tab (its notice) and to the panel as it changes.
const handoffs = new Map();
function setHandoff(tabId, status) {
  if (status) handoffs.set(tabId, status); else handoffs.delete(tabId);
  const msg = { type: "rs:handoff", tabId, ...(status || { ready: true }) };
  sendToTab(tabId, msg).catch(() => { /* still loading: it asks when it's ready */ });
  chrome.runtime.sendMessage(msg).catch(() => { /* no panel open */ });
}

async function startJob({ wfTabId, wfForms, meta, background, auto }) {
  // Real Signature loads in its tab while WEBForms makes the zip (speed, 2026-10-14).
  const tabId = await openRealSignature(background);
  setHandoff(tabId, { busy: "Getting your forms from WEBForms…" });
  try {
    const tZip = Date.now();
    // Same-named forms go in separate downloads (zipBatches); pairs are put back in pick order.
    const paired = new Map();
    for (const batch of zipBatches(wfForms)) {
      const z = await sendToTab(wfTabId, { type: "webforms:zip", forms: batch.map((f) => ({ id: f.id, name: f.name })) });
      for (const p of pairEntries(batch, await unzip(fromBase64(z.zipBase64)))) paired.set(p.form, p);
    }
    const timings = { ...(meta.timings || {}), pdfDownload: Math.round((Date.now() - tZip) / 100) / 10 };
    const forms = wfForms.map((f) => paired.get(f)).map(({ form, data }) => {
      if (!isPdf(data)) throw new Error(`"${form.name}" didn't come back as a PDF.`);
      if (hasAcroForm(data)) throw new Error(`"${form.name}" came back as a fillable PDF, not the flattened form. Not using it.`);
      // From here on a form is known by its TYPE's name (template suggestions, the buyer or
      // seller side, Real's document names); WEBForms' own name was only for the zip.
      return { id: form.id, name: form.typeName || form.name, library: form.library || null,
        formGuid: form.formGuid, pageCount: form.pageCount ?? countPages(data),
        parties: form.parties || null, pdfBase64: toBase64(data) };
    });
    // What "Place blocks from the form's labels" would give each form, read now while the
    // PDF is here: the panel and one click decide from it whether the agent signs (an agent
    // line on the form ticks "Add the agent as a signer", as a template's agent blocks do).
    const tPlace = Date.now();
    // outcome: why it would get no blocks, for a report if it's placed this way (recordLabels).
    for (const f of forms) {
      f.placed = await readPdfText(fromBase64(f.pdfBase64)).then((pages) => {
        const s = placedSummary(autoLayout(pages).layout);
        return { ...s, outcome: placeOutcome({ pages, blocks: s.blocks }) };
      }, (error) => ({ blocks: 0, agent: false, outcome: placeOutcome({ error }) }));
    }
    timings.labels = Math.round((Date.now() - tPlace) / 100) / 10;
    await purgeOld();
    const id = crypto.randomUUID();
    await tx("readwrite", (s) => s.put({ id, createdAt: Date.now(), ...meta, timings, forms, tabId }));
    if (!auto) { setHandoff(tabId, null); return { id, tabId }; }
    setHandoff(tabId, { busy: "Making your draft…" });
    const a = await autoCreate(id);
    // Made: the tab is on the draft already — nothing to tell it. Not made: the panel
    // takes over there, with what it needs.
    if (a.done) handoffs.delete(tabId); else setHandoff(tabId, null);
    return { id, tabId, auto: a };
  } catch (e) {
    const error = String(e?.message || e);
    await recordError({ error: e, step: "handoff", ctx: draftContext({ path: auto ? "one-click" : "panel", forms: wfForms }) }).catch(() => {});
    setHandoff(tabId, { error });
    return { error, tabId };
  }
}

const OWN = chrome.runtime.getURL("");
const RS_TAB_ONLY = new Set(["job:get", "job:status", "made:next"]);
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const fromRsTab = !!sender.tab?.url?.startsWith(RS);
  const fromOwnPage = !sender.tab && String(sender.url || "").startsWith(OWN);
  if (RS_TAB_ONLY.has(msg?.type) ? !fromRsTab : !fromOwnPage) return false;
  (async () => {
    if (msg.type === "job:start") return startJob(msg);
    if (msg.type === "job:status") return handoffs.get(sender.tab?.id) || null;
    // Next on a one-click draft's first step: Real Signature may not change the address.
    if (msg.type === "made:next") return madeSeen(sender.tab?.id).then(() => ({ ok: true }));
    if (msg.type === "job:pending") return handoffs.get(msg.tabId) || null;
    if (msg.type === "job:forTab") {
      const cutoff = Date.now() - JOB_TTL_MS;
      const j = (await allJobs()).filter((x) => x.tabId === msg.tabId && x.createdAt >= cutoff)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return withoutPdfs(j) || null;
    }
    if (msg.type === "job:get") {
      const j = await tx("readonly", (s) => s.get(msg.id));
      return j && j.createdAt >= Date.now() - JOB_TTL_MS ? j : null;
    }
    if (msg.type === "job:done") {
      // The panel's draft: its forms placed from their labels, reported before the job goes.
      if (msg.templateIds?.includes("auto")) {
        const j = await tx("readonly", (s) => s.get(msg.id));
        if (j) recordLabels({ job: withoutPdfs(j), templateIds: msg.templateIds, path: "panel" }).catch(() => {});
      }
      await tx("readwrite", (s) => s.delete(msg.id));
      return { ok: true };
    }
    if (msg.type === "job:auto") return autoCreate(msg.id);
    // The panel on a one-click draft: what was chosen, if the tab is still on that draft.
    // Asking for it is seeing it, so the badge goes.
    if (msg.type === "made:forTab") {
      const { madeFor = {} } = await chrome.storage.session.get("madeFor");
      const made = madeFor[msg.tabId];
      if (!made || !String(msg.url || "").includes(made.draft)) return null;
      if (!made.seen) await madeSeen(msg.tabId);
      return made;
    }
    if (msg.type === "report:error") return recordError({ error: msg.error, step: msg.step, ctx: msg.ctx });
    if (msg.type === "report:ok") return recordOk({ path: msg.path, forms: msg.forms, labels: msg.labels === true }).then(() => ({ ok: true }));
    if (msg.type === "report:last") {
      if (!REPORTS_ON) return null; // nothing to offer: the panel shows no report box
      const { lastReport: l } = await chrome.storage.local.get("lastReport");
      return l && Date.now() - l.at < 10 * 60 * 1000 ? l : null;
    }
    if (msg.type === "report:send-last") {
      const { lastReport: l } = await chrome.storage.local.get("lastReport");
      if (!l || l.at !== msg.at) return { sent: false, gone: true };
      if (l.sent || l.auto) return { sent: !!l.sent, auto: !!l.auto };
      const sent = await post(l.report);
      await chrome.storage.local.set({ lastReport: { ...l, sent } });
      return { sent };
    }
    return null;
  })().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true; // async reply
});
