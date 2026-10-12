// Service worker: holds a hand-off "job" (the PDFs plus what the agent chose) between the
// WEBForms tab and the Real Signature tab. Nothing leaves the browser.
//
// Jobs live in the extension's own IndexedDB, are deleted once the draft is made, and
// anything older than JOB_TTL_MS is purged on startup — contracts must not linger.

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
//   {type: "job:create", job: {title, forms: [{id, name, pageCount, formGuid, pdfBase64}], …}, background?}
//       → stores it, opens Real Signature in a new tab bound to the job → {id, tabId}
//   {type: "job:forTab", tabId}       → that tab's job without the PDFs (for the panel)
//   {type: "job:get", id}             → the whole job (for the Real Signature content script)
//   {type: "job:done", id}            → deletes it
// The tab binding is stored IN the job, not in worker memory: MV3 stops idle workers, and
// a hand-off must survive the agent pausing to sign in to Real Signature.

async function allJobs() {
  return tx("readonly", (s) => s.getAll());
}

const withoutPdfs = (j) => j && { ...j, forms: j.forms.map(({ pdfBase64, ...f }) => f) };

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === "job:create") {
      await purgeOld();
      const id = crypto.randomUUID();
      const job = { id, createdAt: Date.now(), ...msg.job };
      await tx("readwrite", (s) => s.put(job));
      // From the popup the tab opens in the BACKGROUND: making it active would close the
      // popup before it can open the side panel there (msg.background).
      const url = `${RS}home/draft`;
      const tab = await chrome.tabs.create({ url, active: !msg.background });
      await placeUi(tab.id, url); // side panel enabled there before anyone opens it
      await tx("readwrite", (s) => s.put({ ...job, tabId: tab.id }));
      return { id, tabId: tab.id };
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
    return null;
  })().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true; // async reply
});
