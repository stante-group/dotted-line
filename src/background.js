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
//   {type: "job:create", job: {title, forms: [{id, name, pageCount, formGuid, pdfBase64}], …}}
//       → stores it, opens Real Signature in a new tab bound to the job → {id}
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
      const tab = await chrome.tabs.create({ url: "https://signature.therealbrokerage.com/home/draft" });
      await tx("readwrite", (s) => s.put({ ...job, tabId: tab.id }));
      return { id };
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
