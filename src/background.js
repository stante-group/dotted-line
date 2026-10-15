// Service worker: holds a hand-off "job" (the PDFs plus what the agent chose) between the
// WEBForms tab and the Real Signature tab. Nothing leaves the browser.
//
// Jobs live in the extension's own IndexedDB, are deleted once the draft is made, and
// anything older than JOB_TTL_MS is purged on startup — contracts must not linger.

import { planDraft } from "./lib/auto.js";
import { DEFAULT_SETTINGS, subjectFor } from "./lib/pattern.js";
import { sendToTab } from "./messaging.js";

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

async function placeUi(tabId, url) {
  const rs = String(url || "").startsWith(RS);
  await chrome.action.setPopup({ tabId, popup: rs ? "" : POPUP }).catch(() => {});
  await chrome.sidePanel.setOptions(rs ? { tabId, path: PANEL, enabled: true } : { tabId, enabled: false }).catch(() => {});
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.url || info.status === "loading") placeUi(tabId, tab.url); });
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

// Messages:
//   {type: "rs:open", background?}   → opens a Real Signature tab now, so it loads while the
//       PDFs download → {tabId}
//   {type: "job:create", job: {title, forms: [{id, name, pageCount, formGuid, pdfBase64}], …}, background?, tabId?}
//       → stores it, binds it to that tab (or opens a new one) → {id, tabId}
//   {type: "job:forTab", tabId}       → that tab's job without the PDFs (for the panel)
//   {type: "job:get", id}             → the whole job (for the Real Signature content script)
//   {type: "job:done", id}            → deletes it
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
async function autoCreate(id) {
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
  try {
    const c = await sendToTab(job.tabId, { type: "rs:context" });
    lap("realSignatureReady", t0);
    if (!c?.signedIn) return { done: false }; // the panel asks them to sign in
    const { templateFor = {}, agentMode = "one" } = await chrome.storage.local.get(["templateFor", "agentMode"]);
    const plan = planDraft({ job: withoutPdfs(job), c, remembered: templateFor, agentMode });
    if (!plan.ready) { await keep(); return stop(plan.needs); }
    let settings = DEFAULT_SETTINGS;
    try { settings = { ...DEFAULT_SETTINGS, ...((await chrome.storage.sync.get("settings")).settings || {}) }; } catch { /* defaults */ }
    const t1 = Date.now();
    const r = await sendToTab(job.tabId, {
      type: "rs:create", jobId: id, title: job.title, dealId: plan.dealId,
      templateIds: plan.templateIds, counts: plan.counts, agentChoice: plan.agentChoice,
      emailSubject: subjectFor(settings, job.titleValues || {}, job.title),
    });
    lap("draftMade", t1);
    Object.assign(timings, r.timings || {});
    await tx("readwrite", (s) => s.delete(id));
    await chrome.tabs.update(job.tabId, { url: new URL(r.url, RS).toString(), active: true });
    lap("oneClickTotal", t0);
    await keep();
    return { done: true, packet: !!r.packet };
  } catch (e) {
    // rs:create deletes its own half-made drafts before it throws.
    const why = `Couldn't make the draft in one click: ${String(e?.message || e)}`;
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

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === "rs:open") return { tabId: await openRealSignature(msg.background) };
    if (msg.type === "job:create") {
      await purgeOld();
      const id = crypto.randomUUID();
      const job = { id, createdAt: Date.now(), ...msg.job };
      await tx("readwrite", (s) => s.put(job));
      // A tab opened by rs:open while the PDFs downloaded, if it's still there.
      const ready = msg.tabId && await chrome.tabs.get(msg.tabId).catch(() => null);
      const tabId = ready ? ready.id : await openRealSignature(msg.background);
      await tx("readwrite", (s) => s.put({ ...job, tabId }));
      return { id, tabId };
    }
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
      await tx("readwrite", (s) => s.delete(msg.id));
      return { ok: true };
    }
    if (msg.type === "job:auto") return autoCreate(msg.id);
    return null;
  })().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true; // async reply
});
