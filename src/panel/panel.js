// The side panel: all of the extension's UI lives here, never in WEBForms' pages (rule 3).
// Text from WEBForms and reZEN is only ever set with textContent.

import { unzip } from "../lib/unzip.js";
import { isPdf, hasAcroForm, countPages, fromBase64, toBase64 } from "../lib/pdf.js";
import { pairEntries } from "../lib/webforms-api.js";
import { suggestTitle, matchAddress } from "../lib/title.js";
import { rankDeals, wrongDealWarnings } from "../lib/deals.js";
import { suggestTemplate, formKey } from "../lib/match.js";
import { countsFromDeal } from "../lib/draft.js";
import { actingNotes, setupReport } from "../lib/actor.js";

const WF = "https://pr.transactiondesk.com/";
const RS = "https://signature.therealbrokerage.com/";
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

function show(section) {
  for (const s of ["idle", "wf", "rs"]) $(s).hidden = s !== section;
}
function say(text, kind = "note") {
  $("msg").replaceChildren(text ? el("div", text, kind) : "");
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function send(tabId, msg) {
  const r = await chrome.tabs.sendMessage(tabId, msg).catch((e) => ({ error: String(e?.message || e) }));
  if (r?.error) {
    throw new Error(/Receiving end does not exist/.test(r.error)
      ? "Reload this tab once (the extension was installed or updated after it opened)." : r.error);
  }
  return r;
}

// ---------- WEBForms: which forms are picked ----------

// Runs in the PAGE's world (chrome.scripting, world MAIN): the ticks and the Basket live in
// WEBForms' Angular state, which an isolated content script can't see. Read-only, and it
// returns ids and names only.
function readSelection() {
  const ng = window.angular;
  if (!ng) return { error: "WEBForms is still loading." };
  const pick = (x) => (x && x.ID ? { id: x.ID, name: x.Name, transactionId: x.TransactionID || "", lastModified: x.LastModified || null } : null);
  const deal = location.pathname.match(/^\/transaction\/detail\/([^/]+)/i);
  if (deal) {
    const out = new Map();
    for (const node of document.querySelectorAll(".dr-item-selector")) {
      if (!node.querySelector("i.isfontpack-ok_circle")) continue;
      const s = ng.element(node).scope();
      const f = pick(s && (s.form || s.instance));
      if (f) out.set(f.id, f);
    }
    return { source: "deal", transactionId: deal[1], forms: [...out.values()] };
  }
  if (/^\/forms(\/|$)/i.test(location.pathname)) {
    try {
      const items = ng.element(document.body).injector().get("commonSvc").basket.baskets.forms || [];
      return { source: "basket", transactionId: "", forms: items.map(pick).filter(Boolean) };
    } catch {
      return { error: "Couldn't read the Basket — WEBForms may have changed." };
    }
  }
  if (/^\/form\//i.test(location.pathname)) return { source: "open", forms: [] };
  return { source: "other", forms: [] };
}

async function selection(tabId) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readSelection });
  if (r?.result?.error) throw new Error(r.result.error);
  return r?.result || { source: "other", forms: [] };
}

let wfState = null;

async function showWebforms(tab) {
  show("wf");
  $("wf-go").disabled = true;
  $("wf-title-wrap").hidden = true;
  $("wf-forms").replaceChildren();
  const sel = await selection(tab.id);
  const hint = {
    deal: "Tick the forms to send in this deal's Forms list.",
    basket: "Open a form's folder and add your standalone forms to the Basket.",
    open: "Close the form (save it first), then tick it in the deal's Forms list or add it to the Basket.",
    other: "Open a deal's Forms list, or the Forms library for standalone forms.",
  }[sel.source];
  if (!sel.forms.length) { $("wf-where").textContent = hint; wfState = null; return; }

  $("wf-where").textContent = sel.source === "deal"
    ? `${sel.forms.length} form(s) ticked on this deal:` : `${sel.forms.length} form(s) in your Basket:`;
  for (const f of sel.forms) $("wf-forms").append(el("li", f.name));

  // Same-origin, read-only lookups for the title and the deal match (rule 2).
  const transactionId = sel.transactionId
    || (new Set(sel.forms.map((f) => f.transactionId)).size === 1 ? sel.forms[0].transactionId : "");
  const d = await send(tab.id, { type: "webforms:details", transactionId, formIds: sel.forms.map((f) => f.id) });
  const info = new Map(d.forms.map((f) => [f.id, f]));
  wfState = {
    tabId: tab.id, sel, userName: d.userName,
    forms: sel.forms.map((f) => ({ ...f, ...info.get(f.id) })),
    address: matchAddress({ transaction: d.transaction, firstFormValues: d.firstFormValues }),
  };
  $("wf-title").value = suggestTitle({ transaction: d.transaction, forms: sel.forms, firstFormValues: d.firstFormValues });
  $("wf-title-wrap").hidden = false;
  $("wf-go").disabled = false;
}

$("wf-go").addEventListener("click", async () => {
  if (!wfState) return;
  $("wf-go").disabled = true;
  say("Getting your forms from WEBForms…");
  try {
    // Re-read the ticks: the agent may have changed them since the panel last looked.
    const now = await selection(wfState.tabId);
    const ids = (xs) => xs.map((f) => f.id).sort().join();
    if (ids(now.forms) !== ids(wfState.sel.forms)) {
      await showWebforms(await chrome.tabs.get(wfState.tabId));
      say("Your picks changed — check the list and click Create again.", "warn");
      return;
    }
    const z = await send(wfState.tabId, { type: "webforms:zip", forms: wfState.forms.map((f) => ({ id: f.id, name: f.name })) });
    const pairs = pairEntries(wfState.forms, await unzip(fromBase64(z.zipBase64)));
    const forms = pairs.map(({ form, data }) => {
      if (!isPdf(data)) throw new Error(`"${form.name}" didn't come back as a PDF.`);
      if (hasAcroForm(data)) throw new Error(`"${form.name}" came back as a fillable PDF, not the flattened form. Not using it.`);
      return { id: form.id, name: form.name, formGuid: form.formGuid, pageCount: form.pageCount ?? countPages(data), pdfBase64: toBase64(data) };
    });
    const r = await chrome.runtime.sendMessage({ type: "job:create", job: {
      title: $("wf-title").value.trim() || forms[0].name,
      source: wfState.sel.source, address: wfState.address, webformsUserName: wfState.userName, forms,
    } });
    if (r?.error) throw new Error(r.error);
    say("");
  } catch (e) {
    say(String(e.message || e), "err");
    $("wf-go").disabled = false;
  }
});
$("wf-refresh").addEventListener("click", () => refresh());

// ---------- Real Signature: deal, templates, create ----------

let rsState = null;

function option(value, text, { selected = false, disabled = false } = {}) {
  const o = el("option", text);
  o.value = value; o.selected = selected; o.disabled = disabled;
  return o;
}

async function showRealsig(tab, job) {
  show("rs");
  $("rs-form").hidden = true;
  $("rs-status").textContent = "Loading your deals and templates…";
  const c = await send(tab.id, { type: "rs:context" });
  if (!c.signedIn) {
    $("rs-status").textContent = "Sign in to Real Signature in this tab, then click the extension again.";
    return;
  }
  const remembered = (await chrome.storage.local.get("templateFor")).templateFor || {};
  rsState = { tab, job, c, remembered };
  $("rs-status").textContent = `${job.forms.length} form(s) from WEBForms.`;
  $("rs-title").value = job.title;

  // Deals: everything, best address match first — a bad match never hides the right deal.
  const ranked = job.address ? rankDeals(job.address, c.deals) : c.deals.map((deal) => ({ deal, score: 0 }));
  const confident = ranked[0] && ranked[0].score >= 0.75 && !(ranked[1] && ranked[1].score === ranked[0].score);
  const sel = $("rs-deal");
  sel.replaceChildren(
    option("", "Choose a deal…", { selected: !confident, disabled: true }),
    option("none", "No deal (standalone)"),
    ...ranked.map(({ deal }, i) => option(deal.id,
      `${deal.address || "(no address)"} · ${deal.agentName || "?"}${deal.kind === "listing" ? " · listing" : ""}`,
      { selected: confident && i === 0 })),
  );

  // Templates per form.
  const box = $("rs-templates");
  box.replaceChildren();
  job.forms.forEach((form, i) => {
    const s = suggestTemplate(form, c.templates, remembered);
    const div = el("div", null, "form");
    div.append(el("b", `${form.name}${form.pageCount ? ` · ${form.pageCount} page(s)` : ""}`));
    const pick = document.createElement("select");
    pick.id = `tpl-${i}`;
    const opts = [option("", "Choose a template…", { selected: !s.remembered, disabled: true })];
    if (s.remembered) opts.push(option(s.remembered.id, `${s.remembered.name} (last used)`, { selected: true }));
    for (const t of s.suggestions) opts.push(option(t.id, `${t.name} (suggested)`));
    opts.push(option("none", "No template — I'll place blocks in Real Signature"));
    const shown = new Set(opts.map((o) => o.value));
    for (const t of c.templates.filter((t) => !shown.has(t.id)).sort((a, b) => a.name.localeCompare(b.name))) {
      const fits = form.pageCount && t.pagesCount === form.pageCount;
      opts.push(option(t.id, `${t.name}${t.shared ? " (shared)" : ""}${fits ? "" : ` — ${t.pagesCount ?? "?"} pages`}${t.blocks ? "" : " — no signature blocks"}`, { disabled: !fits }));
    }
    pick.replaceChildren(...opts);
    div.append(pick);
    if (s.refused) div.append(el("div", `Your usual template "${s.refused.template.name}" no longer fits: ${s.refused.reason}.`, "warn"));
    box.append(div);
  });

  sel.onchange = updateDeal;
  updateDeal();
  $("rs-form").hidden = false;
}

function updateDeal() {
  const { c, job } = rsState;
  const id = $("rs-deal").value;
  const deal = c.deals.find((d) => d.id === id) || null;
  const notes = [];
  if (deal) {
    notes.push(...wrongDealWarnings({ webformsAddress: job.address, webformsAgentName: null, deal }));
    notes.push(...actingNotes({ me: c.me, deal, webformsUserName: job.webformsUserName }));
    const n = countsFromDeal(deal);
    $("rs-buyers").value = n.BUYER;
    $("rs-sellers").value = n.SELLER;
  } else if (id === "none") {
    notes.push(...actingNotes({ me: c.me, deal: null, webformsUserName: job.webformsUserName }));
  }
  $("rs-warn").replaceChildren(...notes.map((t) => el("div", t, "warn")));
}

$("rs-go").addEventListener("click", async () => {
  const { tab, job, c, remembered } = rsState;
  const dealId = $("rs-deal").value;
  if (!dealId) { say("Choose a deal, or No deal (standalone).", "warn"); return; }
  const templateIds = job.forms.map((_, i) => $(`tpl-${i}`).value);
  if (templateIds.some((t) => !t)) { say("Choose a template (or No template) for every form.", "warn"); return; }
  const counts = { BUYER: Number($("rs-buyers").value) || 0, SELLER: Number($("rs-sellers").value) || 0 };
  $("rs-go").disabled = true;
  say("Creating your draft…");
  try {
    const r = await send(tab.id, {
      type: "rs:create", jobId: job.id, title: $("rs-title").value.trim() || job.title,
      dealId: dealId === "none" ? null : dealId,
      templateIds: templateIds.map((t) => (t === "none" ? null : t)), counts,
    });
    // Remember each form's template choice for next time (this browser only).
    job.forms.forEach((f, i) => { if (templateIds[i] !== "none") remembered[formKey(f)] = templateIds[i]; });
    await chrome.storage.local.set({ templateFor: remembered });
    await chrome.runtime.sendMessage({ type: "job:done", id: job.id });
    await chrome.tabs.update(tab.id, { url: new URL(r.url, RS).toString() });
    say(r.packet ? `Packet draft ready (${r.drafts} documents). Check it, then press Send in Real Signature when you're happy.`
      : "Draft ready. Check it, then press Send in Real Signature when you're happy.", "ok");
    $("rs-form").hidden = true;
    rsState = null;
  } catch (e) {
    say(String(e.message || e), "err");
    $("rs-go").disabled = false;
  }
});

// ---------- setup check (Phase 0 item 7 harness) ----------

$("setup-run").addEventListener("click", async () => {
  $("setup-out").hidden = false;
  $("setup-out").textContent = "Checking…";
  const [rsTab] = await chrome.tabs.query({ url: `${RS}*` });
  const [wfTab] = await chrome.tabs.query({ url: `${WF}*` });
  const rs = rsTab ? await send(rsTab.id, { type: "rs:setup" }).catch(() => null) : null;
  const wf = wfTab ? await send(wfTab.id, { type: "webforms:setup" }).catch(() => null) : null;
  if (wf && rs?.signedIn && wf.signedIn) {
    wf.samePerson = String(wf.userName || "").trim().toLowerCase() === String(rs.fullName || "").trim().toLowerCase();
  }
  let text = setupReport({ rs, wf });
  if (!rsTab) text += "\n(open Real Signature in a tab to check it)";
  if (!wfTab) text += "\n(open WEBForms in a tab to check it)";
  $("setup-out").textContent = text;
});

// ---------- which screen ----------

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const tab = await activeTab();
      if (tab?.url?.startsWith(WF)) { await showWebforms(tab); return; }
      if (tab?.url?.startsWith(RS)) {
        const job = await chrome.runtime.sendMessage({ type: "job:forTab", tabId: tab.id });
        if (job && !job.error) {
          if (rsState?.job?.id !== job.id) await showRealsig(tab, job);
          return;
        }
      }
      if (!$("msg").querySelector(".ok")) say("");
      show("idle");
    } catch (e) {
      say(String(e.message || e), "err");
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((_id, info) => info.status === "complete" && refresh());
refresh();
