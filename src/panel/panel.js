// The side panel: all of the extension's UI lives here, never in WEBForms' pages (rule 3).
// Text from WEBForms and reZEN is only ever set with textContent.

import { suggestTitle, matchAddress } from "../lib/title.js";
import { wrongDealWarnings } from "../lib/deals.js";
import { confidentDeal, usableTemplates, dealGroups, scoresFromText } from "../lib/auto.js";
import { sendToTab } from "../messaging.js";
import { suggestTemplate, rememberKey, normalizeName, rememberEntry, pruneRemembered, signingSide, sideMismatch, LABELS, LABELS_NAME } from "../lib/match.js";
import { titleValues, titleFor, subjectFor, draftTitleValues, draftTitle, draftSubject, formNameFromFile, DEFAULT_SETTINGS } from "../lib/pattern.js";
import { signerCounts, signersWithoutEmail, signeesFromDeal, agentRoleFor, agentPeople, cleanSubject, subjectTooLong, SUBJECT_MAX } from "../lib/draft.js";
import { actingNotes } from "../lib/actor.js";
import { contextFromDraft, REPORTS_ON } from "../lib/report.js";

// The same page is the popup (WEBForms and other sites) and the side panel (Real Signature);
// see background.js "Where the UI shows".
const POPUP = new URLSearchParams(location.search).has("popup");
if (POPUP) document.documentElement.classList.add("popup");

const WF = "https://pr.transactiondesk.com/";
const RS = "https://signature.therealbrokerage.com/";
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

// The Settings page's choices (chrome.storage.sync, so they follow the agent's Chrome
// sign-in). Missing or unreadable → the defaults, which are what Dotted Line always did.
async function settings() {
  try {
    const { settings: s } = await chrome.storage.sync.get("settings");
    return { ...DEFAULT_SETTINGS, ...(s || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// ⓘ buttons: click opens the explanation under it; hover shows the same text as a tooltip
// (kept in step with the tip, which may change as the agent picks things).
document.addEventListener("click", (e) => {
  const b = e.target.closest("button.i");
  if (!b) return;
  e.preventDefault(); // inside a <label> or <summary>, don't also tick or toggle
  const tip = $(b.getAttribute("aria-controls"));
  const open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", String(open));
  tip.hidden = !open;
});
function syncTips() {
  for (const b of document.querySelectorAll("button.i")) {
    b.title = ($(b.getAttribute("aria-controls"))?.textContent || "").replace(/\s+/g, " ").trim();
  }
}

function show(section) {
  for (const s of ["idle", "made", "dr", "up", "wf", "rs"]) $(s).hidden = s !== section;
  // No Settings link beside a draft waiting for its choices: it opens a new tab, and Chrome
  // then dropped this tab's panel — the agent came back to an empty Drafts list and no
  // panel (2026-10-15). Settings is in the WEBForms popup, and the icon's right-click menu.
  $("settings-wrap").hidden = section === "rs";
}
function say(text, kind = "note") {
  $("msg").replaceChildren(text ? el("div", text, kind) : "");
  if (kind !== "err") $("report").hidden = true; // a report belongs to the error it follows
  // Some paths report first and show the error after (the report is made, then the error is
  // thrown up to whoever shows it): move the report into this new red box.
  else if (!$("report").hidden) showReport().catch(() => {});
}

// ---------- error reports (src/lib/report.js, background.js) ----------

async function askConsent() {
  const { reporting } = await chrome.storage.local.get("reporting").catch(() => ({}));
  $("consent").hidden = !REPORTS_ON || reporting === "yes" || reporting === "no";
}
for (const [id, choice] of [["consent-yes", "yes"], ["consent-no", "no"]]) {
  $(id).addEventListener("click", async () => {
    await chrome.storage.local.set({ reporting: choice, reportingAt: Date.now() });
    $("consent").hidden = true;
  });
}
askConsent();

/** Under an error: "sent", or (for an agent who hasn't said yes to reports) a button to
 *  send this one, with exactly what it holds. Shows the last report from the past 10
 *  minutes (the background worker made it), so it's only called right after a failure. */
// The red box of the error a report belongs to: the panel's message, a one-click failure
// above the choices, or a hand-off that failed. The report goes INSIDE it, so the button
// is plainly about that error (Dan, 2026-10-27); with no red box showing, below as before.
function reportHost() {
  const st = $("rs-status");
  return $("msg").querySelector(".err") || $("rs-needs").querySelector(".err") || (st.classList.contains("err") ? st : null);
}

async function showReport() {
  let box = $("report");
  const last = await chrome.runtime.sendMessage({ type: "report:last" }).catch(() => null);
  for (const n of document.querySelectorAll(".report-in-err")) n.remove();
  if (!last?.report) { box.hidden = true; return; }
  const host = reportHost();
  if (host) {
    box.hidden = true;
    box = el("div", "", "report-in-err");
    host.append(box);
  } else {
    box.hidden = false;
  }
  // A repeat: the same failure, every detail alike, within 10 minutes. Said as such — what
  // was sent was the first one, and this one isn't sent again.
  const again = last.repeats ? "The same error happened a few minutes ago" : "";
  if (last.sent || last.auto) {
    box.replaceChildren(el("div", again
      ? `${again} and was sent then, without any client details. It isn't sent again.`
      : last.sent ? "This error was sent to the Deal Dates team, without any client details."
      : "Sending this error to the Deal Dates team, without any client details.", "note"));
    return;
  }
  // A real button, not a link (Dan, 2026-10-27): it sends something.
  const send = el("button", "Send this error to the Deal Dates team", "secondary");
  send.type = "button";
  const what = document.createElement("details");
  what.append(el("summary", "What's sent"), el("pre", JSON.stringify(last.report, null, 1)));
  send.onclick = async () => {
    send.disabled = true;
    const r = await chrome.runtime.sendMessage({ type: "report:send-last", at: last.at }).catch(() => null);
    box.replaceChildren(el("div", r?.sent ? "Sent. Thank you."
      : r?.gone ? "Another error has happened since, so this report was replaced. Nothing was sent."
      : r?.auto ? "It's already being sent automatically."
      : "Couldn't send it. Check your connection and try again later.", "note"));
  };
  box.replaceChildren(...(again ? [el("div", `${again}. One report covers both:`, "note")] : []), send, what);
}

/** The panel's own failures (Finish draft, loading deals): the background worker records
 *  them like its own. Never throws: reporting must not get in the way of the error. */
async function reportError(e, step, draft = {}) {
  // Marked once reported, so a catch further up reports only what nobody has yet.
  try { if (e && typeof e === "object") e.reported = true; } catch { /* frozen: fine */ }
  await chrome.runtime.sendMessage({ type: "report:error", step, error: { message: String(e?.message || e), name: e?.name || "Error" },
    ctx: contextFromDraft({ path: "panel", ...draft }) }).catch(() => null);
  await showReport().catch(() => {});
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

const send = sendToTab;

// ---------- WEBForms: which forms are picked ----------

// Runs in the PAGE's world (chrome.scripting, world MAIN): the ticks and the Basket live in
// WEBForms' Angular state, which an isolated content script can't see. Read-only, and it
// returns ids and names only.
function readSelection() {
  const ng = window.angular;
  if (!ng) return { error: "WEBForms is still loading." };
  const pick = (x) => (x && x.ID ? { id: x.ID, name: x.Name, transactionId: x.TransactionID || "", lastModified: x.LastModified || null } : null);
  // Speed (2026-10-14): what the page already holds is read here rather than asked of
  // WEBForms again — who's signed in (the same object GetPopulatedGlobalJson answers, on
  // every page) and, on a deal, the deal itself. Missing → the content script asks as before.
  let user = null;
  try {
    const g = ng.element(document.body).injector().get("globalVariablesSvc").globalJson;
    const email = g?.GtmDataLayer?.TransactionDesk?.Account?.Email;
    if (g && typeof g.UserName === "string") user = { name: g.UserName, email: typeof email === "string" && email.includes("@") ? email : null };
  } catch { /* asked for instead */ }
  const deal = location.pathname.match(/^\/transaction\/detail\/([^/]+)/i);
  if (deal) {
    const out = new Map();
    for (const node of document.querySelectorAll(".dr-item-selector")) {
      if (!node.querySelector("i.isfontpack-ok_circle")) continue;
      const s = ng.element(node).scope();
      const f = pick(s && (s.form || s.instance));
      if (f) out.set(f.id, f);
    }
    let transaction = null;
    try {
      const t = ng.element(document.querySelector('[ng-controller^="transactionDetailCtrl"]')).scope()?.transaction;
      if (t && typeof t.Name === "string") {
        transaction = Object.fromEntries(["Name", "Address", "StreetNumber", "StreetName", "City", "MLSNumber", "UnitNumber"].map((k) => [k, t[k] ?? null]));
      }
    } catch { /* asked for instead */ }
    return { source: "deal", transactionId: deal[1], user, transaction, forms: [...out.values()] };
  }
  if (/^\/forms(\/|$)/i.test(location.pathname)) {
    try {
      const items = ng.element(document.body).injector().get("commonSvc").basket.baskets.forms || [];
      return { source: "basket", transactionId: "", user, forms: items.map(pick).filter(Boolean) };
    } catch {
      return { error: "Couldn't read the Basket — WEBForms may have changed." };
    }
  }
  if (/^\/form\//i.test(location.pathname)) {
    // Phase 2, an open form. The zip gives the form AS LAST SAVED and WEBForms has no
    // auto-save, so unsaved edits would silently be left out. WEBForms' own leave-page
    // prompt decides "unsaved" by comparing the editor's savedFormFieldValues with
    // formFieldValues, plus hasUnsavedFieldSettings() (formEditorCtrl as vm, seen
    // 2026-10-12) — the same test is used here, only READ. Never call vm.ensureSaved():
    // it saves (rule 2). A value in a field the saved copy doesn't list also counts as
    // unsaved — stricter than WEBForms, because a stale copy is the one thing not allowed.
    const node = document.querySelector('[ng-controller^="formEditorCtrl"]');
    const vm = node && ng.element(node).scope()?.vm;
    const o = vm?.formObj;
    if (!o || !o.ID) return { source: "open", forms: [], loading: true };
    // Fail closed (outside review, 2026-10-15): if WEBForms stops exposing either copy, "no
    // differences" would just mean "nothing to compare" — count it as unsaved, so Create
    // stays off and a stale copy can't go out silently.
    const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
    const shapeOk = isObj(vm.savedFormFieldValues) && isObj(vm.formFieldValues);
    const saved = shapeOk ? vm.savedFormFieldValues : {}, cur = shapeOk ? vm.formFieldValues : {};
    // Money fields are saved as "500000.00" but shown as "500,000.00": an untouched form
    // in a transaction read as unsaved on price and deposit (2026-10-14). The same number,
    // give or take commas, a $ and spaces, is the same value.
    const money = /^\s*\$?\s*-?[\d,]*\.?\d+\s*$/;
    const same = (a, b) => a === b
      || (typeof a === "string" && typeof b === "string" && money.test(a) && money.test(b)
        && Number(a.replace(/[$,\s]/g, "")) === Number(b.replace(/[$,\s]/g, "")));
    let unsaved = !shapeOk || Object.keys(saved).some((k) => !same(cur[k], saved[k]))
      || Object.keys(cur).some((k) => !(k in saved) && cur[k] != null && cur[k] !== "");
    // A check that throws can't vouch for the form either: unknown counts as unsaved.
    try { unsaved = unsaved || !!vm.hasUnsavedFieldSettings?.(); } catch { unsaved = true; }
    const name = o.Name || vm.formData?.FormName || "This form";
    // The address as last SAVED, straight from the page. Asking WEBForms' API right after a
    // Save could still answer with the copy from before it (2026-10-12: the first draft
    // after typing an address and saving was titled with the form name alone; the same
    // form a reload later got the address).
    const address = { txtp_unitNumber: saved.txtp_unitNumber ?? "", txtp_streetnum: saved.txtp_streetnum ?? "", txtp_street: saved.txtp_street ?? "", txtp_city: saved.txtp_city ?? "" };
    // Speed (2026-10-14): the editor already holds what GET formfields answers — page count,
    // FormGUID, the saved values — plus the form type. Asking WEBForms again took ~4 s on
    // every icon click. Handed to the WEBForms content script for the same derivations,
    // never stored.
    const fd = vm.formData || {};
    const preloaded = {
      [o.ID]: {
        pageCount: Number.isInteger(fd.PageCount) ? fd.PageCount : null,
        formGuid: typeof fd.FormGUID === "string" ? fd.FormGUID : null,
        library: typeof o.Library === "string" && o.Library.trim() ? o.Library.trim() : null,
        values: saved,
      },
    };
    return { source: "open", transactionId: o.TransactionID || "", unsaved, cantCheck: !shapeOk, address, preloaded, user,
      forms: [{ id: o.ID, name, transactionId: o.TransactionID || "", lastModified: null }] };
  }
  return { source: "other", forms: [] };
}

async function selection(tabId) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readSelection });
  if (r?.result?.error) throw new Error(r.result.error);
  return r?.result || { source: "other", forms: [] };
}

let wfState = null;
let wfShown = null; // which picks the panel is showing, so a click that changed nothing doesn't redraw
let wfBusy = false;
let autoStarted = false; // Settings → "start when I click the icon": once per popup
// The unsaved flag is part of the key, so pressing Save in WEBForms redraws the panel.
const selKey = (tabId, sel) => `${tabId}|${sel.source}|${sel.forms.map((f) => f.id).sort().join()}|${sel.unsaved ? "unsaved" : ""}`;
const UNSAVED = "Unsaved changes — press Save in WEBForms first.";
const CANT_CHECK = "Can't tell whether this form is saved — WEBForms may have changed. Use the deal's Forms list instead.";

// While an open form has unsaved changes, look again every 2 s: the Save click's own nudge
// arrives before the save has finished, and nothing on the page announces it afterwards.
let wfPoll = null;
function stopPoll() { clearInterval(wfPoll); wfPoll = null; }
function startPoll(tabId) {
  stopPoll();
  wfPoll = setInterval(async () => {
    if (wfBusy || $("wf").hidden) return;
    const tab = await activeTab();
    if (!tab || tab.id !== tabId) { stopPoll(); return; }
    const sel = await selection(tabId).catch(() => null);
    if (sel && selKey(tabId, sel) !== wfShown) { stopPoll(); await refresh(); }
  }, 2000);
}

async function showWebforms(tab) {
  show("wf");
  stopPoll();
  $("wf-go").disabled = true;
  // Settings → "start when I click the icon": the click is made for the agent, so a grey
  // button would only look stuck — the status line says what's happening instead (Dan,
  // 2026-10-29). Shown again once it has started (a redraw after "your picks changed") or
  // if the start fails, so the agent can try again from here.
  $("wf-go").hidden = !!(POPUP && !autoStarted && (await settings()).startOnOpen);
  $("wf-title-wrap").hidden = true;
  $("wf-forms").replaceChildren();
  say("Checking which forms are picked…", "busy");
  const sel = await selection(tab.id);
  wfShown = selKey(tab.id, sel);
  const hint = {
    deal: "Tick the forms to send in this deal's Forms list.",
    basket: "Open a form's folder and add your standalone forms to the Basket.",
    open: "The form is still loading…",
    other: "Open a form, a deal's Forms list, or the Forms library for standalone forms.",
  }[sel.source];
  if (!sel.forms.length) {
    say(""); $("wf-where").textContent = hint; wfState = null;
    if (sel.loading) startPoll(tab.id);
    return;
  }

  $("wf-where").textContent = sel.source === "deal" ? `${sel.forms.length} form(s) ticked on this deal:`
    : sel.source === "open" ? "The form you have open:" : `${sel.forms.length} form(s) in your Basket:`;
  for (const f of sel.forms) $("wf-forms").append(el("li", f.name));
  // The slow part: WEBForms is asked about each form in turn (rule 1), so say so.
  say(`Reading ${sel.forms.length === 1 ? "the form" : `${sel.forms.length} forms`} from WEBForms…`, "busy");

  // Same-origin, read-only lookups for the title and the deal match (rule 2).
  const transactionId = sel.transactionId
    || (new Set(sel.forms.map((f) => f.transactionId)).size === 1 ? sel.forms[0].transactionId : "");
  const tRead = Date.now();
  const d = await send(tab.id, { type: "webforms:details", transactionId, formIds: sel.forms.map((f) => f.id),
    preloaded: sel.preloaded || null, user: sel.user || null, transaction: sel.transaction || null });
  // Seconds, for "Check my setup" (it rides along with the hand-off's other timings).
  const formDetails = Math.round((Date.now() - tRead) / 100) / 10;
  const info = new Map(d.forms.map((f) => [f.id, f]));
  if (sel.address) d.firstFormValues = sel.address; // an open form: the page's saved copy is the freshest
  wfState = {
    tabId: tab.id, sel, userName: d.userName, userEmail: d.userEmail || null, formDetails,
    forms: sel.forms.map((f) => ({ ...f, ...info.get(f.id) })),
    address: matchAddress({ transaction: d.transaction, firstFormValues: d.firstFormValues }),
    buyerNames: d.buyerNames || [],
    agentSide: d.agentSide || null,
    parties: d.parties || null,
    contactPeople: d.contactPeople || [],
  };
  // List each form by its type, with WEBForms' own name after it when that says something
  // else (a standalone form is often named after its civic number, e.g. "120").
  $("wf-forms").replaceChildren(...wfState.forms.map((f) => {
    const li = el("li", f.typeName || f.name);
    if (f.typeName && normalizeName(f.name) !== normalizeName(f.typeName)) li.append(el("span", ` · ${f.name}`, "note"));
    return li;
  }));
  const titled = wfState.forms.map((f) => ({ ...f, name: f.typeName || f.name }));
  // The words a title or subject pattern can use; kept with the hand-off so the subject can
  // be made from them on the Real Signature side, after the title's final edit.
  wfState.titleValues = titleValues({ transaction: d.transaction, forms: titled, firstFormValues: d.firstFormValues, agent: d.userName });
  const suggested = suggestTitle({ transaction: d.transaction, forms: titled, firstFormValues: d.firstFormValues });
  const s = await settings();
  $("wf-title").value = titleFor(s, wfState.titleValues, suggested);
  say("");
  // Not when the icon click starts it: the title goes the moment it's filled in, so a box
  // to edit it changed nothing (Dan, 2026-10-29). It's in the Real Signature panel, and it
  // comes back here, with the button, if the start fails.
  $("wf-title-wrap").hidden = !!(POPUP && s.startOnOpen && !autoStarted);
  if (sel.unsaved) {
    say(sel.cantCheck ? CANT_CHECK : UNSAVED, "warn");
    startPoll(tab.id);
    return; // Create stays off until WEBForms says it's saved
  }
  $("wf-go").disabled = false;
  // Opt-in (Settings): the icon click is the Create click. Once per popup, so a redraw
  // after a fallback to the panel can't start a second hand-off.
  if (POPUP && s.startOnOpen && !autoStarted) {
    autoStarted = true;
    $("wf-go").click();
  }
}

$("wf-go").addEventListener("click", async () => {
  if (!wfState) return;
  $("wf-go").disabled = true;
  wfBusy = true;
  say("Getting your forms from WEBForms…", "busy");
  try {
    // Re-read the ticks: the agent may have changed them since the panel last looked.
    const now = await selection(wfState.tabId);
    const ids = (xs) => xs.map((f) => f.id).sort().join();
    if (ids(now.forms) !== ids(wfState.sel.forms)) {
      await showWebforms(await chrome.tabs.get(wfState.tabId));
      say("Your picks changed — check the list and try again.", "warn");
      return;
    }
    // The last moment to catch an edit made after the panel looked: never send a stale copy.
    if (now.unsaved) {
      await showWebforms(await chrome.tabs.get(wfState.tabId));
      return;
    }
    // The rest runs in the service worker (job:start): this popup closes the moment the
    // agent clicks anything else, and the hand-off must finish anyway (2026-10-15).
    const auto = POPUP && (await settings()).autoCreate;
    const r = await chrome.runtime.sendMessage({ type: "job:start", wfTabId: wfState.tabId, wfForms: wfState.forms, background: POPUP, auto, meta: {
      title: $("wf-title").value.trim() || wfState.forms[0].typeName || wfState.forms[0].name,
      source: wfState.sel.source, address: wfState.address, buyerNames: wfState.buyerNames, agentSide: wfState.agentSide, parties: wfState.parties, contactPeople: wfState.contactPeople, titleValues: wfState.titleValues, webformsUserName: wfState.userName, webformsUserEmail: wfState.userEmail,
      timings: { formDetails: wfState.formDetails },
    } });
    if (r?.error) {
      // Still here, so the agent hasn't gone to that tab: close it, the error is shown here.
      // The worker has recorded it (step "handoff").
      if (r.tabId) chrome.tabs.remove(r.tabId).catch(() => {});
      throw Object.assign(new Error(r.error), { reported: true });
    }
    if (auto) {
      if (r.auto?.done || r.auto?.busy) { window.close(); return; } // busy: that same draft is already being made
      say("");
      await goToRealSignature(r.tabId, !!r.auto?.needs?.length);
      return;
    }
    say("");
    if (POPUP) await goToRealSignature(r.tabId);
  } catch (e) {
    say(String(e.message || e), "err");
    // The worker reports what fails once it has the hand-off; what fails before that here
    // (re-reading the ticks, redrawing the list) is reported here.
    if (e?.reported) showReport().catch(() => {});
    else await reportError(e, "handoff");
    $("wf-go").hidden = false;
    $("wf-title-wrap").hidden = !wfState; // the title is back to edit before trying again
    $("wf-go").disabled = false;
  } finally {
    wfBusy = false;
  }
});
$("wf-refresh").addEventListener("click", () => refresh());

/** Popup only: switch to the new Real Signature tab with the side panel open there.
 *  Chrome opens a side panel only straight after a click, and the download may have taken
 *  long enough to lose that; if so, one more click (a fresh one) does it. */
async function goToRealSignature(tabId, needsYou = false) {
  const go = async () => {
    const opening = chrome.sidePanel.open({ tabId }); // called first, while the click still counts
    await opening;
    await chrome.tabs.update(tabId, { active: true });
    window.close();
  };
  try {
    await go();
  } catch {
    const b = el("button", "Go to Real Signature");
    b.addEventListener("click", () => go().catch(async () => {
      await chrome.tabs.update(tabId, { active: true });
      window.close();
    }));
    $("msg").replaceChildren(el("div", needsYou
      ? "Your forms are in Real Signature, with a choice or two to make before the draft."
      : "Your forms are ready in Real Signature.", needsYou ? "warn" : "ok"), b);
  }
}

// The WEBForms tab says something was clicked: re-read the picks, redraw only if they changed
// (so a typed title survives clicks elsewhere on the page).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "webforms:changed" || wfBusy || $("wf").hidden) return;
  (async () => {
    const tab = await activeTab();
    if (!tab || tab.id !== sender.tab?.id) return;
    const sel = await selection(tab.id).catch(() => null);
    if (sel && selKey(tab.id, sel) !== wfShown) { say(""); await refresh(); }
  })();
});

// ---------- Real Signature: deal, templates, create ----------

// Which agent Real Signature is acting as, from its tab (on load and on change). If that
// isn't who the panel loaded deals, templates and sender for, load again for the same
// hand-off — the TC switched "Acting as".
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "rs:acting" || wfBusy || !rsState || sender.tab?.id !== rsState.tab.id) return;
  const loaded = rsState.c.me?.actingForAgent ? rsState.c.me.id : null;
  if ((msg.actingAs || null) === loaded) return;
  say("");
  const job = rsState.job;
  showRealsig(rsState.tab, job).catch(async (e) => {
    say(String(e.message || e), "err");
    if (!e?.reported) await reportError(e, "context", { job });
  });
});

let rsState = null;

function option(value, text, { selected = false, disabled = false } = {}) {
  const o = el("option", text);
  o.value = value; o.selected = selected; o.disabled = disabled;
  return o;
}

async function showRealsig(tab, job) {
  show("rs");
  hideNotice();
  $("rs-form").hidden = true;
  $("rs-status").textContent = "Loading your deals and templates…";
  $("rs-status").className = "busy";
  let c;
  try {
    c = await send(tab.id, { type: "rs:context" });
  } catch (e) {
    await reportError(e, "context", { job, ...(job.draftId ? { path: "draft" } : {}) });
    throw e;
  } finally {
    $("rs-status").className = "note";
  }
  // A failed earlier try (tab still loading) left its error in #msg; this one worked, so
  // clear it — otherwise the error stays on screen above a panel that loaded fine.
  say("");
  if (!c.signedIn) {
    $("rs-status").textContent = "Sign in to Real Signature in this tab, then click the extension again.";
    return;
  }
  const remembered = (await chrome.storage.local.get("templateFor")).templateFor || {};
  const { agentMode = "one" } = await chrome.storage.local.get("agentMode");
  rsState = { tab, job, c, remembered, agentMode };
  $("rs-agent-pick").replaceChildren(); // a fresh hand-off starts from the remembered mode
  // The second step of the same draft, not a new one: say so, so "Finish draft" reads as
  // the end of what "Prepare in Real Signature" started (Dan, 2026-10-15).
  $("rs-status").textContent = "Almost done — check the choices below.";
  $("rs-title").value = job.title;
  // The subject is shown and sent as seen: it follows the title (or the Settings pattern)
  // until the agent edits it, and a subject over Real's limit holds "Finish draft" rather
  // than being cut on the way (Dan, 2026-10-26). "Leave it to Real Signature" hides it.
  rsState.settings = await settings();
  rsState.subjectEdited = false;
  rsState.titleEdited = false;
  const subject = subjectFor(rsState.settings, job.titleValues || {}, job.title);
  $("rs-subject-wrap").hidden = rsState.settings.subjectMode === "real";
  $("rs-subject").value = subject || "";
  updateSubject();
  if (job.presetTitle) { $("rs-title").value = job.presetTitle; rsState.titleEdited = true; }
  if (job.presetSubject) { $("rs-subject").value = job.presetSubject; rsState.subjectEdited = true; updateSubject(); }

  // A failed one-click attempt goes on top. What's left to choose is said in the section it
  // belongs to (the deal hint, each form's template), not repeated up here.
  $("rs-needs").replaceChildren(...(job.autoError ? [el("div", job.autoError, "err")] : []));
  if (job.autoError) showReport().catch(() => {});
  $("rs-deal-first").textContent = job.address || job.buyerNames?.length || job.textLines
    ? "No deal clearly matches — choose one, or No deal."
    : "Choose the deal, or No deal.";

  // Deals: everything, best address match first — a bad match never hides the right deal.
  // A draft uploaded in Real Signature: each deal's address looked for in the PDF's text.
  let { ranked, deal: best, by } = confidentDeal(job.address, c.deals, job.buyerNames,
    job.textLines ? scoresFromText(job.textLines, c.deals) : null);
  // An uploaded draft whose deal was already picked in Real Signature: that one, first.
  const preset = job.presetDealId ? c.deals.find((d) => d.id === job.presetDealId) : null;
  if (preset) {
    best = preset;
    by = "real";
    ranked = [{ deal: preset, score: 1 }, ...ranked.filter((x) => x.deal !== preset)];
  }
  const confident = !!best;
  // Nothing came close to the address or the buyers: No deal, picked and said so. Several
  // possible deals still wait for the agent's choice.
  const noneFits = by === "none";
  rsState.autoBy = by;
  rsState.noneFits = noneFits;
  // Close matches first, then a group per type (auto.js dealGroups), gaps between as in
  // the template list. Rows at the top say their type themselves; a group's header does.
  const sel = $("rs-deal");
  const { top, groups } = dealGroups(ranked);
  const who = (d) => (d.kind === "buyer" ? d.buyerNames.join(" & ") || "(no buyer)" : d.address || "(no address)");
  const row = (d, tagged) => option(d.id, `${tagged && d.kind === "buyer" ? "Buyer Record: " : ""}${who(d)} · ${d.agentName || "?"}${tagged && d.kind === "listing" ? " · listing" : ""}`,
    { selected: confident && d === ranked[0].deal });
  const gap = () => document.createElement("hr"); // drawn as space: panel.html
  sel.replaceChildren(
    option("", "Choose a deal…", { selected: !confident && !noneFits, disabled: true }),
    ...top.map((d) => row(d, true)),
    ...(top.length ? [gap()] : []),
    option("none", "No deal (standalone)", { selected: noneFits }),
    ...(groups.length ? [gap()] : []),
    ...groups.map((g) => {
      const og = document.createElement("optgroup");
      og.label = g.label;
      og.append(...g.deals.map((d) => row(d, false)));
      return og;
    }),
  );

  // A deal picked for the agent must be visible as such — one agent didn't notice the
  // pre-selection and thought they had chosen No deal (2026-10-11).
  rsState.autoPicked = confident ? ranked[0].deal.id : null;
  rsState.tplSide = undefined; // templates are drawn by updateDeal, once the side is known
  $("rs-templates").replaceChildren(); // not the last hand-off's picks
  sel.onchange = updateDeal;
  updateDeal();
  $("rs-form").hidden = false;
}

/** The template choice per form, for the side that signs. Remembered choices are per side
 *  (rememberKey), so it's redrawn when the deal changes the side, keeping any pick the
 *  agent already made that's still on offer. */
function renderTemplates(side) {
  const { c, job, remembered } = rsState;
  const before = job.forms.map((_, i) => $(`tpl-${i}`)?.value || "");
  const box = $("rs-templates");
  box.replaceChildren();
  job.forms.forEach((form, i) => {
    // Only templates that can help (see usableTemplates): a long greyed-out list just asks
    // the agent a question they can't answer.
    const usable = usableTemplates(form, c.templates);
    const s = suggestTemplate(form, usable, remembered, side);
    const div = el("div", null, "form");
    div.append(el("b", form.name)); // page counts only matter for matching; the ⓘ says so
    const pick = document.createElement("select");
    pick.id = `tpl-${i}`;
    const note = el("div", "", "note");
    let tellRemembered = () => {}; // set below when there are templates to choose between
    pick.onchange = () => { tellRemembered(); updateDeal(); }; // a template can change who signs and how many
    // The template pre-selected because it was used last time: switching from it to the
    // labels is remembered (Dan, 2026-10-29), see rs-go.
    (rsState.lastTemplate ||= [])[i] = s.remembered?.id || null;
    const none = "No template — I'll place blocks in Real Signature";
    // Blocks placed from the form's own printed labels (autoplace.js): Alberta and Manitoba
    // forms so far. The agent checks them in Real Signature, as with any draft.
    // "Auto place", not "labels" (Dan, 2026-10-29: the word confused). LABELS_NAME is the same.
    const auto = LABELS_NAME;
    if (!usable.length) {
      // The option text says it; why none fit is in the Templates ⓘ.
      pick.replaceChildren(option("auto", auto, { selected: true }), option("none", none));
      div.append(pick);
    } else {
      // Nothing remembered or suggested: placing from the labels is the default (Dan,
      // 2026-10-29). A suggestion still waits for the agent's pick, as before.
      // A remembered choice of the labels (s.labels) is pre-selected the same way.
      const pickAuto = !s.remembered && !s.suggestions.length;
      const opts = [option("", "Choose a template…", { selected: !s.remembered && !pickAuto, disabled: true })];
      if (s.remembered) opts.push(option(s.remembered.id, `${s.remembered.name} (last used)`, { selected: true }));
      for (const t of s.suggestions) opts.push(option(t.id, `${t.name} (suggested)`));
      // A gap between the templates and the two choices that aren't templates (the <hr>
      // is drawn as space: panel.html, .form select hr).
      const line = () => document.createElement("hr");
      opts.push(line(), option("auto", s.labels ? `${auto} (last used)` : auto, { selected: pickAuto }), option("none", none), line());
      const shown = new Set(opts.map((o) => o.value));
      for (const t of usable.filter((t) => !shown.has(t.id)).sort((a, b) => a.name.localeCompare(b.name))) {
        opts.push(option(t.id, `${t.name}${t.shared ? " (shared)" : ""}`));
      }
      pick.replaceChildren(...opts);
      if (before[i] && opts.some((o) => o.value === before[i])) pick.value = before[i];
      div.append(pick);
      // What next time will do with this choice — the one thing between this form and one
      // click. It said "Remembered" under the labels too, which were never remembered
      // (Dan's test, 2026-10-29).
      const forSide = side ? ` for ${side === "BUYER" ? "buyer" : "seller"} deals` : "";
      tellRemembered = () => {
        const v = pick.value;
        note.textContent = !v || v === "none" ? ""
          : v === "auto" ? (s.labels ? "" : s.remembered ? `Auto place is remembered${forSide} next time.`
            : "Not remembered: one click asks again next time. Choose a template to have it remembered.")
          : v === s.remembered?.id ? "" : `Remembered${forSide} next time.`;
        note.hidden = !note.textContent;
      };
      div.append(note);
      tellRemembered();
      // usableTemplates lists them all when the page count is unknown: say it can't vouch.
      if (!form.pageCount) div.append(el("div", "Couldn't read this form's page count — make sure the template is for this form.", "warn"));
    }
    // A remembered template that stopped fitting (form revised, or no blocks for this side)
    // is filtered out above, so check it against the full list to say why it's gone.
    const refused = suggestTemplate(form, c.templates, remembered, side).refused;
    if (refused) {
      div.append(el("div", refused.kind === "side"
        ? `"${refused.template.name}" has no ${side === "BUYER" ? "buyer" : "seller"} blocks — choose another.`
        : `"${refused.template.name}" no longer fits: ${refused.reason}.`, "warn"));
    }
    box.append(div);
  });
  rsState.tplSide = side;
}

// Whether "Finish draft" can go: a deal (or No deal) chosen, a template (or No template)
// for every form, and a subject Real will take. The button greys out until then rather
// than saying so only after it's pressed (Dan, 2026-10-28); the note under it says why.
function canFinish() {
  const id = $("rs-deal").value;
  const chosen = !!rsState?.c.deals.find((d) => d.id === id) || id === "none";
  const tplHeld = chosen && !templatesChosen();
  $("rs-go-why").hidden = !tplHeld;
  return chosen && !tplHeld && !subjectHeld();
}

function templatesChosen() {
  return (rsState?.job.forms || []).every((_, i) => !!$(`tpl-${i}`)?.value);
}

function subjectHeld() {
  return !$("rs-subject-wrap").hidden && subjectTooLong($("rs-subject").value);
}

function updateSubject() {
  const n = cleanSubject($("rs-subject").value).length;
  const over = n > SUBJECT_MAX;
  $("rs-subject-count").textContent = `${n}/${SUBJECT_MAX}`;
  $("rs-subject-count").className = over ? "count over" : "count";
  $("rs-subject-note").hidden = !over;
  $("rs-subject").setAttribute("aria-invalid", String(over));
  if (rsState) $("rs-go").disabled = !canFinish();
}

function updateDeal() {
  const { c, job } = rsState;
  const id = $("rs-deal").value;
  const deal = c.deals.find((d) => d.id === id) || null;
  // Step by step: the rest shows once the deal (or No deal) is chosen — it decides who
  // signs. A deal picked for the agent shows everything at once, no extra click.
  const chosen = !!deal || id === "none";
  $("rs-after-deal").hidden = !chosen;
  $("rs-deal-first").hidden = chosen;
  // Before the counts: they read the template picks, and the side picks the templates.
  const side = signingSide({ deal, agentSide: job.agentSide });
  if (side !== rsState.tplSide) renderTemplates(side);
  $("rs-go").disabled = !canFinish(); // after the templates are drawn: it reads the picks
  // An uploaded draft has no WEBForms words for the title and subject patterns: the form
  // from the file name and the place from the deal picked here, redone when the deal
  // changes, until the agent edits them. Without this the subject was just "Please sign"
  // (Dan's test, 2026-10-30).
  if (job.draftId) {
    job.titleValues = draftTitleValues({ fileName: job.fileName, deal });
    if (!rsState.titleEdited) $("rs-title").value = titleFor(rsState.settings, job.titleValues, draftTitle(job.titleValues)) || job.title;
    if (!rsState.subjectEdited) {
      $("rs-subject").value = draftSubject(rsState.settings, job.titleValues, $("rs-title").value.trim() || job.title) || "";
      updateSubject();
    }
  }
  const notes = [];
  // A template picked by hand that has blocks only for the side that isn't signing.
  job.forms.forEach((form, i) => {
    const t = c.templates.find((x) => x.id === $(`tpl-${i}`)?.value);
    const why = t && sideMismatch(t, side);
    if (why) notes.push(`${form.name}: "${t.name}" would place no blocks — ${why}.`);
  });
  if (id === "none" && rsState.noneFits) {
    notes.push({ level: "info", text: job.draftId ? "No reZEN deal's address is on this form, so it's made without one. Choose a deal if there is one."
      : "No reZEN deal matches this address or buyer, so it's made without one. Choose a deal if there is one." });
  }
  if (deal && deal.id === rsState.autoPicked) {
    notes.push(rsState.autoBy === "real"
      ? { level: "info", text: "The deal already chosen for this draft in Real Signature." }
      : rsState.autoBy === "name"
      ? "Picked for you because the buyer's name matches this Buyer Record. Check it's the right one, or choose another (or No deal)."
      : job.draftId ? "Picked for you because its address is on this form. Check it's the right deal, or choose another (or No deal)."
      : "Picked for you because the address matches. Check it's the right deal, or choose another (or No deal).");
  }
  if (deal?.kind === "buyer") {
    notes.push({ level: "info", text: "The buyers are filled in from the Buyer Record. The draft isn't attached to it in reZEN — attach the deal in Real Signature once there is one." });
  }
  // Always worked out, deal picked or not: before a pick the boxes showed the HTML's
  // starting 2 and 2, which read as the answer (2026-10-14). With no deal yet, the numbers
  // are the no-deal ones (WEBForms Contacts and forms, the agent's side there).
  {
    // The picked templates' signer slots count too (see signerCounts).
    const templates = job.forms.map((_, i) => $(`tpl-${i}`)?.value)
      .map((tid) => c.templates.find((t) => t.id === tid)?.slots).filter(Boolean);
    // Contacts and forms already merged on the WEBForms side; older hand-offs per form.
    const webforms = job.parties ? [job.parties] : job.forms.map((f) => f.parties).filter(Boolean);
    const { counts: n, why } = signerCounts({ deal, formNames: job.forms.map((f) => f.name), templates, webforms, agentSide: job.agentSide });
    $("rs-buyers").value = n.BUYER;
    $("rs-sellers").value = n.SELLER;
    $("rs-counts-why").textContent = why;
  }
  if (deal) {
    notes.push(...wrongDealWarnings({ webformsAddress: job.address, webformsAgentName: null, deal }));
    notes.push(...actingNotes({ me: c.me, deal, webformsUserName: job.webformsUserName, webformsUserEmail: job.webformsUserEmail }));
    const n = { BUYER: Number($("rs-buyers").value) || 0, SELLER: Number($("rs-sellers").value) || 0 };
    for (const p of signersWithoutEmail(deal, n)) {
      const who = `${p.role === "BUYER" ? "Buyer" : "Seller"} ${p.slot}${p.name ? ` (${p.name})` : ""}`;
      notes.push(`${who} has no email in reZEN, so they're left off — add them in Real Signature before sending.`);
    }
  } else if (id === "none") {
    // No reZEN deal: the signers come from the WEBForms deal's Contacts when they have emails.
    const n = { BUYER: Number($("rs-buyers").value) || 0, SELLER: Number($("rs-sellers").value) || 0 };
    const people = { participants: job.contactPeople || [] };
    const filled = signeesFromDeal(people, n).length;
    if (filled) {
      notes.push({ level: "info", text: `${filled === 1 ? "1 signer is" : `${filled} signers are`} filled in from the WEBForms Contacts.` });
      for (const p of signersWithoutEmail(people, n)) {
        notes.push(`${p.role === "BUYER" ? "Buyer" : "Seller"} ${p.slot}${p.name ? ` (${p.name})` : ""} has no email in WEBForms, so they're left off — add them in Real Signature before sending.`);
      }
    } else {
      // Real's own Transaction step attaches a deal but doesn't fill in its clients on a draft
      // whose signer roles are already set up (tried 2026-10-12) — only picking it here does.
      // Short (Dan, 2026-10-15: too much text): the why is in the deal ⓘ.
      notes.push({ level: "info", text: job.draftId ? "No deal, so you'll add the signers in Real Signature."
        : "No client emails in WEBForms — you'll add the signers in Real Signature." });
    }
    notes.push(...actingNotes({ me: c.me, deal: null, webformsUserName: job.webformsUserName, webformsUserEmail: job.webformsUserEmail }));
  }
  // Plain strings are warnings; actingNotes gives {level, text}. Warnings first, then the
  // quiet context lines.
  const all = notes.map((n) => (typeof n === "string" ? { level: "warn", text: n } : n));
  $("rs-warn").replaceChildren(
    ...all.filter((n) => n.level !== "info").map(warnBox),
    ...all.filter((n) => n.level === "info").map((n) => el("div", n.text, "info")),
  );
  updateAgent();
}

/** A warning, plus — for a TC acting for a different agent than WEBForms — an OFFER to
 *  switch. Only an offer: one teammate may have built the forms for the agent she's acting
 *  as (Dan, 2026-10-15). The switch itself is Real's own "Acting as" menu; we open it, she
 *  picks. Never set Real's cookie ourselves (CLAUDE.md). */
function warnBox(n) {
  const box = el("div", n.text, "warn");
  if (!n.switchTo) return box;
  const b = el("button", `Switch to ${n.switchTo}`, "link");
  b.type = "button";
  b.style.display = "block";
  b.style.marginTop = "6px";
  b.onclick = async () => {
    const r = await send(rsState.tab.id, { type: "rs:open-acting" }).catch(() => null);
    b.replaceWith(el("div", `${r?.opened ? "Real's menu is open" : "Use Acting as, bottom left in Real Signature"}: pick ${n.switchTo}. This panel reloads when you do. Not listed? ${n.switchTo} needs to switch on Real Signature for you in reZEN first.`, "note"));
  };
  box.append(b);
  return box;
}

const ROLE_LABEL = { BUYERS_AGENT: "Buyer's agent", SELLERS_AGENT: "Seller's agent" };
const ROLE_WORD = { BUYER: "buyer", SELLER: "seller", BUYERS_AGENT: "buyer's agent", SELLERS_AGENT: "seller's agent" };
/** ["BUYER", "SELLER"] → "buyer and seller roles" (words for the draft-ready line). */
function roleWords(types = []) {
  const w = types.map((t) => ROLE_WORD[t] || "signer");
  return `${w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w.at(-1)}` : w[0] || "signer"} role${w.length > 1 ? "s" : ""}`;
}

/** The "Add the agent as a signer" box: which forms it would touch, and as whom. Mirrors
 *  what rs:create does per form (agentRoleFor + agentPerson), so the note is the truth. */
function updateAgent() {
  const { c, job } = rsState;
  const deal = c.deals.find((d) => d.id === $("rs-deal").value) || null;
  const counts = { BUYER: Number($("rs-buyers").value) || 0, SELLER: Number($("rs-sellers").value) || 0 };
  const picked = job.forms.map((_, i) => $(`tpl-${i}`)?.value);
  // Placed blocks: the agent signs a form whose labels include an agent line (placed, read
  // in the background); with no such line there's nowhere to put their blocks.
  const noAgentLine = (i) => picked[i] === "auto" && job.forms[i].placed && !job.forms[i].placed.agent;
  const roles = picked.map((tid, i) => (!tid || noAgentLine(i) ? null : tid === "none" || tid === "auto"
    ? agentRoleFor({ layout: null, counts, dealSide: deal?.side || job.agentSide })
    : c.templates.find((t) => t.id === tid)?.agentRole ?? null));
  // Why a form gets no agent, in words about the TEMPLATE — the form itself may well have
  // agent lines printed on it; what's missing is a template block or a role to put them in.
  const skipped = job.forms.map((f, i) => {
    if (roles[i]) return null;
    const tid = picked[i];
    if (!tid) return { form: f.name, why: "pick a template (or No template) first" };
    if (tid !== "none" && tid !== "auto") return { form: f.name, why: "its template has no agent blocks" };
    if (noAgentLine(i)) return { form: f.name, why: "the form has no agent line to place blocks on" };
    if (!counts.BUYER && !counts.SELLER) return { form: f.name, why: "no template and no buyers or sellers, so it can't tell whether the agent signs as buyer's or seller's agent" };
    return { form: f.name, why: "no template, and both buyers and sellers sign, so it can't tell whether the agent signs as buyer's or seller's agent" };
  }).filter(Boolean);
  // Ticked for the agent when a picked template already has agent blocks — the template
  // says the agent signs — or a form placed from its labels has an agent line. Otherwise
  // off. Once the agent touches the box, theirs stands.
  if (!rsState.agentTouched) {
    $("rs-agent").checked = picked.some((tid, i) => c.templates.find((t) => t.id === tid)?.agentRole
      || (tid === "auto" && job.forms[i].placed?.agent));
  }
  const forms = roles.filter(Boolean);
  const role = forms[0];
  const people = role ? agentPeople({ deal, role, me: c.me, webformsUserName: job.webformsUserName, webformsUserEmail: job.webformsUserEmail }) : [];
  const on = $("rs-agent").checked;

  // Two or more agents on the deal (a team): one signs, or all of them. The panel remembers
  // which the agent last chose — a team's practice (or its jurisdiction's) doesn't change
  // deal to deal. The specific person is not remembered; the best match leads each time.
  const pick = $("rs-agent-pick");
  $("rs-agent-pick-wrap").hidden = !(on && people.length > 1);
  if (people.length > 1) {
    const prev = pick.value;
    const keyOf = (p) => p.email;
    const want = prev && (prev === "all" || people.some((p) => keyOf(p) === prev)) ? prev
      : rsState.agentMode === "all" ? "all" : keyOf(people[0]);
    pick.replaceChildren(
      ...people.map((p, i) => option(keyOf(p), i === 0 ? `${p.name} (suggested)` : p.name, { selected: want === keyOf(p) })),
      option("all", `All ${people.length} agents`, { selected: want === "all" }),
    );
  } else {
    pick.replaceChildren();
  }

  // Visible: one short line of what will happen. The why goes in the agent ⓘ.
  let text = "", more = "";
  const skippedText = skipped.map((s) => `${s.form}: ${s.why}.`).join(" ");
  if (!forms.length) {
    if (on) {
      text = skipped.length === 1 && ["none", "auto"].includes(picked[0]) && job.forms.length === 1
        ? "Can't tell which agent role to use without a template — add the agent in Real Signature."
        : "Not added to any form here — add the agent in Real Signature.";
    }
    more = `${skippedText} `;
  } else if (!people.length) {
    text = "No agent email on this deal — add the agent in Real Signature.";
  } else if (on) {
    const label = ROLE_LABEL[role] || "agent";
    const where = forms.length === job.forms.length ? "" : ` on ${forms.length} of ${job.forms.length} forms`;
    if (skipped.length) more = `Not added to: ${skippedText} `;
    if (people.length > 1 && pick.value === "all") {
      text = `Adds all ${people.length} agents as ${label}s${where}.`;
      more += "Templates have blocks for one agent, so place the other agents' blocks in Real Signature.";
    } else {
      const who = people.find((p) => p.email === pick.value) || people[0];
      text = `Adds ${who.name} as ${label}${where}.`;
      if (people.length > 1) more += "Your choice of one agent or all of them is remembered for next time.";
    }
  }
  $("rs-agent-who").textContent = text;
  $("rs-agent-more").textContent = more;
  syncTips();
}

/** What rs:create is told: null (agent not added), "all", or the chosen agent's email. */
function agentChoice() {
  if (!$("rs-agent").checked) return null;
  const v = $("rs-agent-pick").value;
  return v || "best"; // "best" isn't an email, so chooseAgents falls back to the best match
}
$("rs-agent").addEventListener("change", () => { if (rsState) { rsState.agentTouched = true; updateAgent(); } });
$("rs-agent-pick").addEventListener("change", () => {
  if (!rsState) return;
  rsState.agentMode = $("rs-agent-pick").value === "all" ? "all" : "one";
  chrome.storage.local.set({ agentMode: rsState.agentMode });
  updateAgent();
});
for (const id of ["rs-buyers", "rs-sellers"]) $(id).addEventListener("input", () => rsState && updateAgent());
$("rs-title").addEventListener("input", () => {
  if (rsState) rsState.titleEdited = true;
  if (!rsState || rsState.subjectEdited) return;
  const { job, settings: s } = rsState;
  $("rs-subject").value = (job.draftId ? draftSubject : subjectFor)(s, job.titleValues || {}, $("rs-title").value.trim() || job.title) || "";
  updateSubject();
});
$("rs-subject").addEventListener("input", () => { if (rsState) { rsState.subjectEdited = true; updateSubject(); } });

$("rs-go").addEventListener("click", async () => {
  const { tab, job, c } = rsState;
  const dealId = $("rs-deal").value;
  if (!dealId) { say("Choose a deal, or No deal (standalone).", "warn"); return; }
  const templateIds = job.forms.map((_, i) => $(`tpl-${i}`).value);
  if (templateIds.some((t) => !t)) { say("Choose a template (or No template) for every form.", "warn"); return; }
  const counts = { BUYER: Number($("rs-buyers").value) || 0, SELLER: Number($("rs-sellers").value) || 0 };
  if (subjectHeld()) { say("Shorten the signers' email subject to 70 characters.", "warn"); return; }
  $("rs-go").disabled = true;
  if (job.draftId) { await finishDraft(templateIds[0], counts); return; }
  say(job.forms.length > 1 ? `Creating ${job.forms.length} drafts and grouping them as a packet…` : "Creating your draft…", "busy");
  try {
    const t1 = Date.now();
    const r = await send(tab.id, {
      type: "rs:create", jobId: job.id, title: $("rs-title").value.trim() || job.title,
      dealId: dealId === "none" ? null : dealId,
      templateIds: templateIds.map((t) => (t === "none" ? null : t)), counts,
      agentChoice: agentChoice(),
      // What the field shows is what's sent; hidden = leave Real Signature's own.
      emailSubject: $("rs-subject-wrap").hidden ? null : cleanSubject($("rs-subject").value) || null,
    });
    // Timings for "Check my setup": a draft finished here (one click stopped to ask
    // something) only had the steps up to the stop — add the making of it (numbers only).
    const draftMade = Math.round((Date.now() - t1) / 100) / 10;
    chrome.storage.local.get("lastTimings").then(({ lastTimings: t }) => chrome.storage.local.set({ lastTimings: {
      ...(t?.job === job.id ? t : { job: job.id, forms: job.forms.length }), at: Date.now(), draftMade, ...(r.timings || {}) } })).catch(() => {});
    // Remember each form's template choice for next time (this browser only), for this
    // side when the deal says which (rememberKey). Re-read first: the Settings page may have
    // removed some since this panel loaded.
    const { templateFor: stored = {} } = await chrome.storage.local.get("templateFor");
    const next = pruneRemembered(stored);
    const side = signingSide({ deal: c.deals.find((d) => d.id === dealId) || null, agentSide: job.agentSide });
    job.forms.forEach((f, i) => {
      const tid = templateIds[i];
      if (tid === "none") return; // a choice, not a template to remember
      // The labels are remembered only when the agent switched to them from the template
      // used last time (Dan, 2026-10-29). As the default for a form with nothing
      // remembered they're not a choice, and one click keeps asking until there is one.
      if (tid === "auto") {
        if (rsState.lastTemplate?.[i]) next[rememberKey(f, side)] = rememberEntry(f, { id: LABELS, name: LABELS_NAME });
        return;
      }
      next[rememberKey(f, side)] = rememberEntry(f, c.templates.find((t) => t.id === tid) || { id: tid });
    });
    await chrome.storage.local.set({ templateFor: next });
    await chrome.runtime.sendMessage({ type: "job:done", id: job.id, templateIds });
    chrome.runtime.sendMessage({ type: "report:ok", path: "panel", forms: job.forms.length, labels: templateIds.includes("auto") }).catch(() => {});
    await chrome.tabs.update(tab.id, { url: new URL(r.url, RS).toString() });
    say(r.packet && r.drafts === 1 ? `Draft ready. Add the ${roleWords(r.unfilled)} in Add Signees.`
      : r.packet ? `Packet ready (${r.drafts} forms).` : "Draft ready.", "ok");
    $("rs-form").hidden = true;
    rsState = null;
    // Done: the agent is on the draft, and the panel would only cover it. Leave the message
    // up long enough to read, then close. sidePanel.close() is newer Chrome (141+);
    // window.close() closes a side panel on older versions. Failures stay open (catch below).
    setTimeout(() => {
      Promise.resolve(chrome.sidePanel?.close?.({ tabId: tab.id }))
        .catch(() => {}).finally(() => window.close());
    }, 1500);
  } catch (e) {
    say(String(e.message || e), "err");
    $("rs-go").disabled = !canFinish();
    await reportError(e, "create", { c, job, dealId: dealId === "none" ? null : dealId,
      // "none": No deal was the default because nothing came close (report deal "none-default").
      dealBy: dealId === rsState?.autoPicked || (dealId === "none" && rsState?.noneFits) ? rsState.autoBy : null,
      templateIds: templateIds.map((t) => (t === "none" ? null : t)), counts,
      warned: !!$("rs-warn").querySelector(".warn") });
  }
});

/** Finish for a draft uploaded in Real Signature (openDraft): the same choices, saved onto
 *  that draft (rs:setup-draft) instead of a new upload. Templates aren't remembered: an
 *  upload's file name isn't a form type. */
async function finishDraft(templateId, counts) {
  const { tab, job, c } = rsState;
  const dealId = $("rs-deal").value;
  say("Setting up your draft…", "busy");
  try {
    const r = await send(tab.id, {
      type: "rs:setup-draft", id: job.draftId, title: $("rs-title").value.trim() || job.title,
      dealId: dealId === "none" ? null : dealId,
      templateId: templateId === "none" ? null : templateId, counts, agentChoice: agentChoice(),
      emailSubject: $("rs-subject-wrap").hidden ? null : cleanSubject($("rs-subject").value) || null,
    });
    if (r?.error) throw new Error(r.error);
    // The day's count, and — Auto place having found nothing — why, as Prepare's does.
    const auto = templateId === "auto";
    chrome.runtime.sendMessage({ type: "report:ok", path: "panel", forms: 1, labels: auto }).catch(() => {});
    if (auto && job.forms[0].placed?.outcome) {
      chrome.runtime.sendMessage({ type: "report:placed", outcome: job.forms[0].placed.outcome, added: 0 }).catch(() => {});
    }
    rsState = null;
    // The same address reloads: Real's steps show the deal, signers and blocks just saved.
    await chrome.tabs.update(tab.id, { url: new URL(r.url, RS).toString() });
    say(r.packet ? `Draft ready. Add the ${roleWords(r.unfilled)} in Add Signees.` : "Draft ready. Check it in Real Signature before you send.", "ok");
    $("rs-form").hidden = true;
    // Done, as after a WEBForms draft: the panel would only cover the steps. (The packet of
    // one this can make would also have shown "packets aren't set up yet" under it.)
    setTimeout(() => {
      Promise.resolve(chrome.sidePanel?.close?.({ tabId: tab.id }))
        .catch(() => {}).finally(() => window.close());
    }, 1500);
  } catch (e) {
    say(String(e.message || e), "err");
    $("rs-go").disabled = !canFinish();
    await reportError(e, "on-draft", { path: "draft", c, job, dealId: dealId === "none" ? null : dealId,
      dealBy: dealId === rsState?.autoPicked || (dealId === "none" && rsState?.noneFits) ? rsState.autoBy : null,
      templateIds: [templateId === "none" ? null : templateId], counts,
      warned: !!$("rs-warn").querySelector(".warn") });
  }
}

// ---------- a hand-off still under way (job:start) ----------

// The Real Signature tab's own notice ("click the Dotted Line icon…") — this panel is open now.
function hideNotice() {
  activeTab().then((t) => t && chrome.tabs.sendMessage(t.id, { type: "rs:notice-hide" }).catch(() => {}));
}

function showHandoff(p) {
  show("rs");
  hideNotice();
  $("rs-form").hidden = true;
  $("rs-status").textContent = p.error ? `Couldn't bring your forms over: ${p.error}` : p.busy;
  $("rs-status").className = p.error ? "err" : "busy";
  if (p.error) showReport().catch(() => {});
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "rs:handoff" || POPUP) return;
  activeTab().then((tab) => {
    if (tab?.id !== msg.tabId) return;
    if (msg.ready) refresh(); else showHandoff(msg);
  });
});

// ---------- a one-click draft, afterwards ----------

// What one click chose (auto.js madeSummary), on that draft: the panel used to say only
// "open a form in WEBForms", and nothing showed that No deal or the labels were its choice
// (Dan, 2026-10-29). Each fix is one Real Signature already offers on the draft.
function showMade(made) {
  const items = [];
  items.push(made.deal
    ? el("li", `Deal: ${made.deal} (${made.dealBy === "name" ? "Buyer Record, matched by the buyers' names" : "matched by address"})`)
    : el("li", "No deal: no reZEN deal or Buyer Record matched the form's address or buyers."));
  for (const f of made.forms) {
    items.push(el("li", `${f.name}: ${f.how === "labels" ? `auto placed from the form's labels${f.chosen ? " (your choice last time)" : ""}`
      : f.how === "template" ? `your template "${f.template}"` : "no template"}`));
  }
  if (made.agent) items.push(el("li", "The agent is added as a signer."));
  $("made-list").replaceChildren(...items);
  const fixes = [];
  if (!made.deal) fixes.push("If there is a deal, choose it in Real Signature's Transaction step.");
  if (made.forms.some((f) => f.how === "labels")) fixes.push("Check the auto placed blocks in Prepare.");
  $("made-note").textContent = fixes.join(" ");
  if (!$("msg").querySelector(".ok")) say("");
  show("made");
}

// ---------- a draft uploaded in Real Signature: Auto place (src/lib/ondraft.js) ----------

// Real's one-time document steps (Transaction → Edit details → Prepare → Review) all live at
// this address. A packet's are at PACKET_URL below.
const DRAFT_URL = /^https:\/\/signature\.therealbrokerage\.com\/one-time-documents\/document\/([0-9a-f-]{36})(?:[/?#]|$)/i;
// Clicking a draft on the Drafts list opens its preview first, with Next to the steps
// (Dan's test, 2026-10-30) — the place to set it up. Only a one-time draft's preview: the
// same /view/ pages show sent documents, which are never touched.
const VIEW_URL = /^https:\/\/signature\.therealbrokerage\.com\/view\/document\/([0-9a-f-]{36})\?(?:[^#]*&)?oneTimeUse=true(?:[&#]|$)/i;
// A packet's own steps (its Edit, where the signers are set once for every document) and
// its one-time preview. Clicking the packet's name opens the preview, which has no actions;
// its Edit opens the steps (Dan's test, 2026-10-30).
const PACKET_URL = /^https:\/\/signature\.therealbrokerage\.com\/one-time-documents\/packet\/([0-9a-f-]{36})(?:[/?#]|$)/i;
const PACKET_VIEW_URL = /^https:\/\/signature\.therealbrokerage\.com\/view\/packet\/([0-9a-f-]{36})\?(?:[^#]*&)?oneTimeUse=true(?:[&#]|$)/i;
const draftIdOf = (url) => DRAFT_URL.exec(url)?.[1] || VIEW_URL.exec(url)?.[1] || null;
const packetIdOf = (url) => PACKET_URL.exec(url)?.[1] || PACKET_VIEW_URL.exec(url)?.[1] || null;
// Real sends a packet's document only with its packet ("associated with a packet. Please
// send the packet instead"), so the agent goes back to the packet's own steps.
const IN_PACKET = "This document is in a packet: send it from the packet (Drafts list → the packet's Edit), not from here.";
let drBusy = false;

/** "1 seller and the seller's agent" from the draft's signer counts. */
function signerWords({ counts, agentRole }) {
  const n = (t) => counts[t] || 0;
  const parts = ["BUYER", "SELLER"].filter(n).map((t) => `${n(t)} ${ROLE_WORD[t]}${n(t) > 1 ? "s" : ""}`);
  if (agentRole === "both") parts.push("the buyer's and seller's agents");
  else if (agentRole) parts.push(`the ${ROLE_WORD[agentRole]}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "other signers only";
}

const NO_BLOCKS = {
  "no-text": "This PDF is a scan: it has no text to read, so no blocks were placed. Place them in Real Signature.",
  fonts: "This PDF's text can't be read as words, so no blocks were placed. Place them in Real Signature.",
  "no-labels": "No signature lines Dotted Line knows were found on this form. Place the blocks in Real Signature.",
  "pdf-locked": "This PDF is locked, so Dotted Line can't read it. Place the blocks in Real Signature.",
  "pdf-unreadable": "Dotted Line couldn't read this PDF. Place the blocks in Real Signature.",
};

/** A one-time draft uploaded in Real Signature. Nobody set up yet: the whole draft from the
 *  PDF, as from WEBForms (showRealsig with the draft standing in for a hand-off). Signers
 *  already named in Edit details: blocks only, for them (the "dr" screen). */
async function openDraft(tab, id) {
  if (drBusy || wfBusy) return;
  if (rsState?.job?.draftId === id) { show("rs"); return; } // the same draft, choices as left
  show("dr");
  $("dr-form").hidden = true;
  $("dr-status").className = "busy";
  $("dr-status").textContent = "Reading this draft…";
  const info = await send(tab.id, { type: "rs:draft-read", id }).catch((e) => ({ error: String(e?.message || e) }));
  if (info?.error) {
    $("dr-status").className = "err";
    $("dr-status").textContent = `Couldn't read this draft: ${info.error}`;
    await reportError(new Error(info.error), "on-draft", { path: "draft" });
    return;
  }
  if (info.template) { show("idle"); return; }
  if (info.inPacket) {
    // Blocks only: the deal, subject and signers are set on the packet's own steps.
    showDraft(tab, id, info);
    if (!info.signers) $("dr-status").textContent = `${IN_PACKET} Add who signs there (Edit details) and press Next, then use Dotted Line on the packet.`;
    else $("dr-who").textContent += ` ${IN_PACKET}`;
    return;
  }
  if (!info.signers && !info.blocks) {
    const name = formNameFromFile(info.name || "Draft");
    await showRealsig(tab, {
      id: `draft:${id}`, draftId: id, title: name, fileName: info.name || "", presetDealId: info.transactionId,
      // Never over the agent's own choices (Dan, 2026-10-30): an upload is named after its
      // file, so a name without ".pdf" was given in Real Signature, and a saved subject was
      // typed there. Both stay as they are.
      presetTitle: /\.pdf$/i.test(String(info.name || "")) ? null : info.name, presetSubject: info.emailSubject,
      forms: [{ name, pageCount: info.pageCount, placed: info.placed, library: null }],
      // A scan has no text: nothing to match, so the agent picks (not "nothing matched").
      textLines: info.lines?.length ? info.lines : null,
    });
    return;
  }
  showDraft(tab, id, info);
}

// Real Signature's home pages (Sent, Draft, Voided — where a dropped PDF lands). Before the
// draft's own steps there was nothing in the panel (Dan's test, 2026-10-30).
const HOME_URL = /^https:\/\/signature\.therealbrokerage\.com\/home(?:[/?#]|$)/i;

/** Recent uploads nobody has set up yet, each opening its draft — the panel then sets it up. */
async function showUploads(tab) {
  show("up");
  $("up-status").className = "busy";
  $("up-status").textContent = "Looking for new uploads…";
  $("up-list").replaceChildren();
  const r = await send(tab.id, { type: "rs:recent-uploads" }).catch((e) => ({ error: String(e?.message || e) }));
  if (r?.error) {
    $("up-status").className = "err";
    $("up-status").textContent = `Couldn't read your Drafts: ${r.error}`;
    await reportError(new Error(r.error), "on-draft", { path: "draft" });
    return;
  }
  $("up-status").className = "note";
  $("up-status").textContent = r.length ? "New uploads, not set up yet:" : "";
  $("up-list").replaceChildren(...r.map((d) => {
    const div = el("div", null, "form");
    div.append(el("b", d.name));
    const b = el("button", "Set up with Dotted Line");
    b.type = "button";
    b.onclick = () => chrome.tabs.update(tab.id, { url: new URL(`/one-time-documents/document/${d.id}`, RS).toString() });
    div.append(b);
    return div;
  }));
}

$("up-refresh").addEventListener("click", () => refresh());

function showDraft(tab, id, info) {
  $("dr-status").className = "note";
  if (!info.signers) {
    $("dr-status").textContent = "To place blocks on this draft, first add who signs in Real Signature (Edit details) and press Next. Then come back here on the Prepare step.";
    return;
  }
  $("dr-status").textContent = "";
  $("dr-who").textContent = `Signers: ${signerWords(info.signers)}.${info.blocks ? ` ${info.blocks} block${info.blocks > 1 ? "s" : ""} already on it stay.` : ""}`;
  $("dr-form").hidden = false;
  $("dr-go").disabled = false;
  $("dr-go").onclick = () => placeDraft(tab, id);
}

async function placeDraft(tab, id) {
  drBusy = true;
  $("dr-go").disabled = true;
  $("dr-status").className = "busy";
  $("dr-status").textContent = "Placing blocks…";
  say("");
  try {
    const r = await send(tab.id, { type: "rs:place-draft", id });
    if (r?.error) throw new Error(r.error);
    $("dr-status").className = "note";
    $("dr-status").textContent = "";
    chrome.runtime.sendMessage({ type: "report:placed", outcome: r.added ? null : r.outcome, added: r.added }).catch(() => {});
    if (r.added) {
      say(`Placed ${r.added} block${r.added > 1 ? "s" : ""}. Real Signature reloads to show them: check every block on Prepare before you send.`, "ok");
      // Real's editor holds the draft as it loaded it; a reload shows the new blocks, and
      // stops its next save from writing back the draft without them.
      await chrome.tabs.reload(tab.id);
    } else {
      say(NO_BLOCKS[r.outcome] || (r.skipped
        ? "Every block Dotted Line would place is already on this draft."
        : "This form's signature lines are all for signers who aren't on this draft. Check Edit details."), "warn");
      $("dr-go").disabled = false;
    }
  } catch (e) {
    $("dr-status").className = "note";
    $("dr-status").textContent = "";
    say(`Couldn't place blocks: ${String(e?.message || e)}`, "err");
    await reportError(e, "on-draft", { path: "draft" });
    $("dr-go").disabled = false;
  } finally {
    drBusy = false;
  }
}

/** A packet draft on its own steps: Auto place on each of its documents whose signers are
 *  set (the packet's Edit details saves them on every document). Blocks only, as on a
 *  single draft's Prepare; the packet's deal, subject and signers are Real's. */
async function openPacket(tab, id) {
  if (drBusy || wfBusy) return;
  show("dr");
  $("dr-form").hidden = true;
  $("dr-status").className = "busy";
  $("dr-status").textContent = "Reading this packet…";
  const info = await send(tab.id, { type: "rs:packet-read", id }).catch((e) => ({ error: String(e?.message || e) }));
  if (info?.error) {
    $("dr-status").className = "err";
    $("dr-status").textContent = `Couldn't read this packet: ${info.error}`;
    await reportError(new Error(info.error), "on-draft", { path: "draft" });
    return;
  }
  if (info.template) { show("idle"); return; }
  $("dr-status").className = "note";
  const ready = info.docs.filter((d) => d.signers);
  if (!ready.length) {
    $("dr-status").textContent = "To place blocks on this packet, first add who signs (Edit details) and press Next. Then come back here on the Prepare step.";
    return;
  }
  const many = info.docs.length > 1;
  $("dr-status").textContent = ready.length < info.docs.length
    ? `${info.docs.length - ready.length} of its documents ${info.docs.length - ready.length > 1 ? "have" : "has"} no signers yet and ${info.docs.length - ready.length > 1 ? "are" : "is"} left as ${info.docs.length - ready.length > 1 ? "they are" : "it is"}.` : "";
  $("dr-who").textContent = many
    ? ready.map((d) => `${d.name}: ${signerWords(d.signers)}${d.blocks ? `, ${d.blocks} block${d.blocks > 1 ? "s" : ""} already on it stay` : ""}.`).join(" ")
    : `Signers: ${signerWords(ready[0].signers)}.${ready[0].blocks ? ` ${ready[0].blocks} block${ready[0].blocks > 1 ? "s" : ""} already on it stay.` : ""}`;
  $("dr-form").hidden = false;
  $("dr-go").disabled = false;
  $("dr-go").onclick = () => placePacket(tab, ready.map((d) => d.id));
}

async function placePacket(tab, ids) {
  drBusy = true;
  $("dr-go").disabled = true;
  $("dr-status").className = "busy";
  $("dr-status").textContent = "Placing blocks…";
  say("");
  let added = 0, skipped = 0, outcome = null;
  try {
    // One document at a time: each is its own read and save, like a single draft's.
    for (const id of ids) {
      const r = await send(tab.id, { type: "rs:place-draft", id });
      if (r?.error) throw new Error(r.error);
      added += r.added;
      skipped += r.skipped;
      if (!r.added) outcome ||= r.outcome;
    }
    $("dr-status").className = "note";
    $("dr-status").textContent = "";
    chrome.runtime.sendMessage({ type: "report:placed", outcome: added ? null : outcome, added }).catch(() => {});
    if (added) {
      say(`Placed ${added} block${added > 1 ? "s" : ""}. Real Signature reloads to show them: check every block on Prepare before you send.`, "ok");
      await chrome.tabs.reload(tab.id);
    } else {
      say(NO_BLOCKS[outcome] || (skipped
        ? "Every block Dotted Line would place is already on this packet."
        : "This packet's signature lines are all for signers who aren't on it. Check Edit details."), "warn");
      $("dr-go").disabled = false;
    }
  } catch (e) {
    $("dr-status").className = "note";
    $("dr-status").textContent = "";
    // Documents already done keep their blocks: say so, rather than a bare failure.
    say(`Couldn't place blocks${added ? ` on every document (${added} placed before it stopped)` : ""}: ${String(e?.message || e)}`, "err");
    await reportError(e, "on-draft", { path: "draft" });
    $("dr-go").disabled = false;
    if (added) await chrome.tabs.reload(tab.id);
  } finally {
    drBusy = false;
  }
}

// ---------- which screen ----------

let refreshing = null;
async function refresh() {
  // Not while a Create is under way: the Real Signature tab it opened finishes loading
  // mid-way, and a redraw then switched Create back on before the draft was made
  // (2026-10-14). The Create click sees its own ending through (draft, panel or error).
  if (wfBusy) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const tab = await activeTab();
      if (tab?.url?.startsWith(WF)) {
        // Reading the picks off the WEBForms page is reported too (step "handoff", the
        // WEBForms side of it): a WEBForms change that breaks the read is the failure we'd
        // most want to hear about, and it used to show only in red (Dan's test, 2026-10-27).
        await showWebforms(tab).catch(async (e) => { await reportError(e, "handoff"); throw e; });
        return;
      }
      if (tab?.url?.startsWith(RS)) {
        // Clicked over before the forms arrived: say what's happening; job:ready redraws.
        const pending = await chrome.runtime.sendMessage({ type: "job:pending", tabId: tab.id });
        if (pending) { showHandoff(pending); return; }
        const job = await chrome.runtime.sendMessage({ type: "job:forTab", tabId: tab.id });
        if (job && !job.error) {
          // Same hand-off as before (back from Settings, say): show it again with the agent's
          // choices as they left them. Without show(), the idle screen another tab put up
          // stayed, and the panel looked empty (2026-10-15).
          if (rsState?.job?.id !== job.id) await showRealsig(tab, job);
          else show("rs");
          return;
        }
        const made = await chrome.runtime.sendMessage({ type: "made:forTab", tabId: tab.id, url: tab.url });
        if (made && !made.error) { showMade(made); return; }
        const draftId = draftIdOf(tab.url);
        if (draftId) { await openDraft(tab, draftId); return; }
        if (HOME_URL.test(tab.url)) { await showUploads(tab); return; }
        const packetId = packetIdOf(tab.url);
        if (packetId) { await openPacket(tab, packetId); return; }
      }
      if (!$("msg").querySelector(".ok")) say("");
      show("idle");
    } catch (e) {
      say(String(e.message || e), "err");
      // Loading deals and reading WEBForms report their own; anything else that broke a
      // redraw (finding the tab's hand-off, drawing the choices) is reported here.
      if (!e?.reported) await reportError(e, "context");
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

$("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((_id, info) => {
  // Real Signature moves between its pages without a page load, so leaving a one-click
  // draft for the Drafts list only changes the address — and the summary stayed up there
  // (Dan's test, 2026-10-29). Only while the summary shows: elsewhere an address change
  // would redraw choices the agent is in the middle of.
  // Dropping a PDF in moves Real from Sent to its Drafts list the same way, and opening a
  // draft too: those address changes redraw, so the new upload or the draft shows.
  if (info.status === "complete" || (info.url && (!$("made").hidden || HOME_URL.test(info.url) || draftIdOf(info.url) || packetIdOf(info.url)))) refresh();
});
syncTips();
refresh();
