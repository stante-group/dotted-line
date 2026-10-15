// Messages to a tab's content script, shared by the panel and the service worker.
//
// "Receiving end does not exist" usually means the tab's page hasn't finished loading, so
// its content script (document_idle) isn't listening yet: Real Signature tabs are created a
// moment before they're asked. Starting a second draft right after a first one hit this
// every time (2026-10-12). So wait and retry for a while; only a tab that stays deaf really
// needs a reload (one opened before the extension was installed or updated).

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
  if (r?.error) {
    throw new Error(NOT_LISTENING.test(r.error)
      ? "Reload this tab once (the extension was installed or updated after it opened)." : r.error);
  }
  return r;
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
