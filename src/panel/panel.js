const $ = (id) => document.getElementById(id);

async function activeWebformsTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith("https://pr.transactiondesk.com/") ? tab : null;
}

async function refresh() {
  const tab = await activeWebformsTab();
  if (!tab) {
    $("where").textContent = "Open a deal or a form in WEBForms.";
    $("send").disabled = true;
    return;
  }
  const w = await chrome.tabs.sendMessage(tab.id, { type: "webforms:where" }).catch(() => null);
  $("where").textContent = w?.page === "form" ? "You're in an open form."
    : w?.page === "transaction" ? "You're on a deal in WEBForms." : "Open a deal or a form in WEBForms.";
  $("send").disabled = !w || w.page === "other";
}

$("send").addEventListener("click", async () => {
  $("msg").textContent = "";
  const tab = await activeWebformsTab();
  if (!tab) return;
  const r = await chrome.tabs.sendMessage(tab.id, { type: "webforms:collect" }).catch((e) => ({ error: String(e) }));
  if (r?.error) { $("msg").textContent = r.error; return; }
  const job = await chrome.runtime.sendMessage({ type: "job:create", job: r });
  if (job?.error) $("msg").textContent = job.error;
});

chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((_id, info) => info.status === "complete" && refresh());
refresh();
