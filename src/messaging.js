// Messages to a tab's content script, shared by the panel and the service worker.
//
// "Receiving end does not exist" usually means the tab's page hasn't finished loading, so
// its content script (document_idle) isn't listening yet: Real Signature tabs are created a
// moment before they're asked. Starting a second draft right after a first one hit this
// every time (2026-10-12). So wait and retry for a while. A tab that stays deaf was opened
// before the extension was installed or updated: Chrome only adds content scripts to pages
// loaded after. That was the commonest error report by far ("Reload this tab once", 14 of
// the first 27, an outside user's among them, 2026-10-31), so the script is added to the
// tab here, as the manifest would have, and asked again. Only if that fails too is the
// agent asked to reload.

const NOT_LISTENING = /Receiving end does not exist|Could not establish connection/;

export async function sendToTab(tabId, msg) {
  const ask = () => chrome.tabs.sendMessage(tabId, msg).catch((e) => ({ error: String(e?.message || e) }));
  let r = await ask();
  // Up to 15 s while the tab is still loading; 2 s more once it says it's loaded (the
  // script starts just after). A long-open stale tab gives up after those 2 s.
  for (let i = 0; i < 30 && NOT_LISTENING.test(r?.error || ""); i++) {
    const loading = (await chrome.tabs.get(tabId).catch(() => null))?.status === "loading";
    if (!loading && i >= 4) break;
    await new Promise((ok) => setTimeout(ok, 500));
    r = await ask();
  }
  if (NOT_LISTENING.test(r?.error || "") && await addContentScript(tabId)) {
    for (let i = 0; i < 6 && NOT_LISTENING.test(r?.error || ""); i++) {
      await new Promise((ok) => setTimeout(ok, 250));
      r = await ask();
    }
  }
  if (r?.error) {
    throw new Error(NOT_LISTENING.test(r.error)
      // Save first: WEBForms has no auto-save, so a reload mid-edit loses the edit.
      ? "Save your changes on this page, then reload this tab once (the extension was installed or updated after it opened)." : r.error);
  }
  return r;
}

/** The manifest's content script for this tab's site, added to the tab now. → true if added. */
async function addContentScript(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = String(tab?.url || "");
  const cs = (chrome.runtime.getManifest().content_scripts || [])
    .find((c) => c.matches.some((m) => url.startsWith(m.replace(/\*$/, ""))));
  if (!cs) return false;
  return chrome.scripting.executeScript({ target: { tabId }, files: cs.js }).then(() => true, () => false);
}

/** Ask every open tab of one site, most recently used first, until one answers. Asking
 *  only the first one Chrome lists hit a stale tab (opened before the extension was
 *  reloaded, can't answer) while a fresh one sat in another window (2026-10-12).
 *  → {tabs: how many were open, r: the answer or null, error} */
export async function askOpenTab(url, msg) {
  const tabs = (await chrome.tabs.query({ url })).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  let error = null;
  for (const t of tabs) {
    const r = await sendToTab(t.id, msg).catch((e) => { error = String(e?.message || e).slice(0, 200); return null; });
    if (r) return { tabs: tabs.length, r };
  }
  return { tabs: tabs.length, r: null, error };
}
