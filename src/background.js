// Service worker: holds a hand-off "job" (the PDFs plus what the agent chose) between the
// WEBForms tab and the Real Signature tab. Nothing leaves the browser.
//
// Jobs live in the extension's own IndexedDB, are deleted once the draft is made, and
// anything older than JOB_TTL_MS is purged on startup — contracts must not linger.

const DB = "wfrs";
const STORE = "jobs";
const JOB_TTL_MS = 60 * 60 * 1000;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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
    t.oncomplete = () => resolve(out?.result ?? out);
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
//   {type: "job:create", job: {forms: [{name, pageCount, formGuid, pdfBase64}], webforms: {...}}}
//       → stores it, opens Real Signature in a new tab bound to the job → {id}
//   {type: "job:forTab"}              → the job bound to the sender's tab, if any
//   {type: "job:done", id}            → deletes it
const tabJobs = new Map(); // tabId → jobId (lost on worker restart; the job TTL covers that)

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === "job:create") {
      const id = crypto.randomUUID();
      await tx("readwrite", (s) => s.put({ id, createdAt: Date.now(), ...msg.job }));
      const tab = await chrome.tabs.create({ url: "https://signature.therealbrokerage.com/" });
      tabJobs.set(tab.id, id);
      return { id };
    }
    if (msg.type === "job:forTab") {
      const id = tabJobs.get(sender.tab?.id);
      return id ? await tx("readonly", (s) => s.get(id)) : null;
    }
    if (msg.type === "job:done") {
      await tx("readwrite", (s) => s.delete(msg.id));
      for (const [t, j] of tabJobs) if (j === msg.id) tabJobs.delete(t);
      return { ok: true };
    }
    return null;
  })().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true; // async reply
});
