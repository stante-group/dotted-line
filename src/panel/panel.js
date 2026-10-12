// The side panel: all of the extension's UI lives here, never in WEBForms' pages (rule 3).
// Text from WEBForms and reZEN is only ever set with textContent.

import { unzip } from "../lib/unzip.js";
import { isPdf, hasAcroForm, countPages, fromBase64, toBase64 } from "../lib/pdf.js";
import { pairEntries } from "../lib/webforms-api.js";
import { suggestTitle, matchAddress } from "../lib/title.js";
import { rankDeals, wrongDealWarnings } from "../lib/deals.js";
import { suggestTemplate, formKey } from "../lib/match.js";
import { signerCounts, signersWithoutEmail, agentRoleFor, agentPeople } from "../lib/draft.js";
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
let wfShown = null; // which picks the panel is showing, so a click that changed nothing doesn't redraw
let wfBusy = false;
const selKey = (tabId, sel) => `${tabId}|${sel.source}|${sel.forms.map((f) => f.id).sort().join()}`;

async function showWebforms(tab) {
  show("wf");
  $("wf-go").disabled = true;
  $("wf-title-wrap").hidden = true;
  $("wf-forms").replaceChildren();
  say("Checking which forms are picked…", "busy");
  const sel = await selection(tab.id);
  wfShown = selKey(tab.id, sel);
  const hint = {
    deal: "Tick the forms to send in this deal's Forms list.",
    basket: "Open a form's folder and add your standalone forms to the Basket.",
    open: "Close the form (save it first), then tick it in the deal's Forms list or add it to the Basket.",
    other: "Open a deal's Forms list, or the Forms library for standalone forms.",
  }[sel.source];
  if (!sel.forms.length) { say(""); $("wf-where").textContent = hint; wfState = null; return; }

  $("wf-where").textContent = sel.source === "deal"
    ? `${sel.forms.length} form(s) ticked on this deal:` : `${sel.forms.length} form(s) in your Basket:`;
  for (const f of sel.forms) $("wf-forms").append(el("li", f.name));
  // The slow part: WEBForms is asked about each form in turn (rule 1), so say so.
  say(`Reading ${sel.forms.length === 1 ? "the form" : `${sel.forms.length} forms`} from WEBForms…`, "busy");

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
  say("");
  $("wf-title-wrap").hidden = false;
  $("wf-go").disabled = false;
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
      say("Your picks changed — check the list and click Create again.", "warn");
      return;
    }
    const z = await send(wfState.tabId, { type: "webforms:zip", forms: wfState.forms.map((f) => ({ id: f.id, name: f.name })) });
    const pairs = pairEntries(wfState.forms, await unzip(fromBase64(z.zipBase64)));
    const forms = pairs.map(({ form, data }) => {
      if (!isPdf(data)) throw new Error(`"${form.name}" didn't come back as a PDF.`);
      if (hasAcroForm(data)) throw new Error(`"${form.name}" came back as a fillable PDF, not the flattened form. Not using it.`);
      return { id: form.id, name: form.name, formGuid: form.formGuid, pageCount: form.pageCount ?? countPages(data),
        parties: form.parties || null, pdfBase64: toBase64(data) };
    });
    say("Opening Real Signature…", "busy");
    const r = await chrome.runtime.sendMessage({ type: "job:create", job: {
      title: $("wf-title").value.trim() || forms[0].name,
      source: wfState.sel.source, address: wfState.address, webformsUserName: wfState.userName, forms,
    } });
    if (r?.error) throw new Error(r.error);
    say("");
  } catch (e) {
    say(String(e.message || e), "err");
    $("wf-go").disabled = false;
  } finally {
    wfBusy = false;
  }
});
$("wf-refresh").addEventListener("click", () => refresh());

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
  $("rs-status").className = "busy";
  const c = await send(tab.id, { type: "rs:context" }).finally(() => { $("rs-status").className = "note"; });
  if (!c.signedIn) {
    $("rs-status").textContent = "Sign in to Real Signature in this tab, then click the extension again.";
    return;
  }
  const remembered = (await chrome.storage.local.get("templateFor")).templateFor || {};
  const { agentMode = "one" } = await chrome.storage.local.get("agentMode");
  rsState = { tab, job, c, remembered, agentMode };
  $("rs-agent-pick").replaceChildren(); // a fresh hand-off starts from the remembered mode
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
    // Only templates that can help: same page count AND at least one signature, initial or
    // date block. Agents who rarely use Real Signature have many text-only templates, and
    // a long greyed-out list just asks them a question they can't answer.
    const usable = c.templates.filter((t) => t.blocks > 0 && form.pageCount && t.pagesCount === form.pageCount);
    const s = suggestTemplate(form, usable, remembered);
    const div = el("div", null, "form");
    div.append(el("b", `${form.name}${form.pageCount ? ` · ${form.pageCount} page(s)` : ""}`));
    const pick = document.createElement("select");
    pick.id = `tpl-${i}`;
    pick.onchange = () => updateDeal(); // a template can change who signs and how many
    const none = "No template — I'll place blocks in Real Signature";
    if (!usable.length) {
      pick.replaceChildren(option("none", none, { selected: true }));
      div.append(pick, el("div", "None of your Real Signature templates fit this form, so you'll place the signature blocks yourself in Real Signature.", "note"));
    } else {
      const opts = [option("", "Choose a template…", { selected: !s.remembered, disabled: true })];
      if (s.remembered) opts.push(option(s.remembered.id, `${s.remembered.name} (last used)`, { selected: true }));
      for (const t of s.suggestions) opts.push(option(t.id, `${t.name} (suggested)`));
      opts.push(option("none", none));
      const shown = new Set(opts.map((o) => o.value));
      for (const t of usable.filter((t) => !shown.has(t.id)).sort((a, b) => a.name.localeCompare(b.name))) {
        opts.push(option(t.id, `${t.name}${t.shared ? " (shared)" : ""}`));
      }
      pick.replaceChildren(...opts);
      div.append(pick);
    }
    // A remembered template that stopped fitting (form revised) is filtered out above, so
    // check it against the full list to say why it's gone.
    const refused = suggestTemplate(form, c.templates, remembered).refused;
    if (refused) div.append(el("div", `Your usual template "${refused.template.name}" no longer fits: ${refused.reason}.`, "warn"));
    box.append(div);
  });

  // A deal picked for the agent must be visible as such — one agent didn't notice the
  // pre-selection and thought they had chosen No deal (2026-10-11).
  rsState.autoPicked = confident ? ranked[0].deal.id : null;
  sel.onchange = updateDeal;
  updateDeal();
  $("rs-form").hidden = false;
}

function updateDeal() {
  const { c, job } = rsState;
  const id = $("rs-deal").value;
  const deal = c.deals.find((d) => d.id === id) || null;
  const notes = [];
  if (deal && deal.id === rsState.autoPicked) {
    notes.push("Picked for you because the address matches. Check it's the right deal, or choose another (or No deal).");
  }
  if (deal || id === "none") {
    // The picked templates' signer slots count too (see signerCounts).
    const templates = job.forms.map((_, i) => $(`tpl-${i}`)?.value)
      .map((tid) => c.templates.find((t) => t.id === tid)?.slots).filter(Boolean);
    const webforms = job.forms.map((f) => f.parties).filter(Boolean);
    const { counts: n, why } = signerCounts({ deal, formNames: job.forms.map((f) => f.name), templates, webforms });
    $("rs-buyers").value = n.BUYER;
    $("rs-sellers").value = n.SELLER;
    $("rs-counts-why").textContent = why;
  } else {
    $("rs-counts-why").textContent = "";
  }
  if (deal) {
    notes.push(...wrongDealWarnings({ webformsAddress: job.address, webformsAgentName: null, deal }));
    notes.push(...actingNotes({ me: c.me, deal, webformsUserName: job.webformsUserName }));
    const n = { BUYER: Number($("rs-buyers").value) || 0, SELLER: Number($("rs-sellers").value) || 0 };
    for (const p of signersWithoutEmail(deal, n)) {
      const who = `${p.role === "BUYER" ? "Buyer" : "Seller"} ${p.slot}${p.name ? ` (${p.name})` : ""}`;
      notes.push(`${who} has no email in reZEN, so they're left off — add them in Real Signature before sending.`);
    }
  } else if (id === "none") {
    notes.push(...actingNotes({ me: c.me, deal: null, webformsUserName: job.webformsUserName }));
  }
  $("rs-warn").replaceChildren(...notes.map((t) => el("div", t, "warn")));
  updateAgent();
}

const ROLE_LABEL = { BUYERS_AGENT: "Buyer's agent", SELLERS_AGENT: "Seller's agent" };

/** The "Add the agent as a signer" box: which forms it would touch, and as whom. Mirrors
 *  what rs:create does per form (agentRoleFor + agentPerson), so the note is the truth. */
function updateAgent() {
  const { c, job } = rsState;
  const deal = c.deals.find((d) => d.id === $("rs-deal").value) || null;
  const counts = { BUYER: Number($("rs-buyers").value) || 0, SELLER: Number($("rs-sellers").value) || 0 };
  const picked = job.forms.map((_, i) => $(`tpl-${i}`)?.value);
  const roles = picked.map((tid) => (!tid ? null : tid === "none"
    ? agentRoleFor({ layout: null, counts })
    : c.templates.find((t) => t.id === tid)?.agentRole ?? null));
  // Ticked for the agent when a picked template already has agent blocks — the template
  // says the agent signs. Otherwise off. Once the agent touches the box, theirs stands.
  if (!rsState.agentTouched) {
    $("rs-agent").checked = picked.some((tid) => c.templates.find((t) => t.id === tid)?.agentRole);
  }
  const forms = roles.filter(Boolean);
  const role = forms[0];
  const people = role ? agentPeople({ deal, role, me: c.me, webformsUserName: job.webformsUserName }) : [];
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

  let text = "";
  if (!forms.length) {
    text = "None of these forms has a place for the agent to sign (their templates have no agent blocks).";
  } else if (!people.length) {
    text = "Couldn't find the agent's email on this deal — add the agent in Real Signature.";
  } else if (on) {
    const where = forms.length === job.forms.length ? "" : ` on ${forms.length} of ${job.forms.length} forms (the others' templates have no agent blocks)`;
    const label = ROLE_LABEL[role] || "agent";
    if (people.length > 1 && pick.value === "all") {
      text = `Adds all ${people.length} agents as ${label}s${where}. Templates have blocks for one agent, so place the others' blocks in Real Signature.`;
    } else {
      const who = people.find((p) => p.email === pick.value) || people[0];
      text = `Adds ${who.name} as ${label}${where}.`;
    }
  }
  $("rs-agent-who").textContent = text;
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

$("rs-go").addEventListener("click", async () => {
  const { tab, job, c, remembered } = rsState;
  const dealId = $("rs-deal").value;
  if (!dealId) { say("Choose a deal, or No deal (standalone).", "warn"); return; }
  const templateIds = job.forms.map((_, i) => $(`tpl-${i}`).value);
  if (templateIds.some((t) => !t)) { say("Choose a template (or No template) for every form.", "warn"); return; }
  const counts = { BUYER: Number($("rs-buyers").value) || 0, SELLER: Number($("rs-sellers").value) || 0 };
  $("rs-go").disabled = true;
  say(job.forms.length > 1 ? `Creating ${job.forms.length} drafts and grouping them as a packet…` : "Creating your draft…", "busy");
  try {
    const r = await send(tab.id, {
      type: "rs:create", jobId: job.id, title: $("rs-title").value.trim() || job.title,
      dealId: dealId === "none" ? null : dealId,
      templateIds: templateIds.map((t) => (t === "none" ? null : t)), counts,
      agentChoice: agentChoice(),
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
    // Done: the agent is on the draft, and the panel would only cover it. Leave the message
    // up long enough to read, then close. sidePanel.close() is newer Chrome (141+);
    // window.close() closes a side panel on older versions. Failures stay open (catch below).
    setTimeout(() => {
      Promise.resolve(chrome.sidePanel?.close?.({ windowId: tab.windowId }))
        .catch(() => {}).finally(() => window.close());
    }, 1500);
  } catch (e) {
    say(String(e.message || e), "err");
    $("rs-go").disabled = false;
  }
});

// ---------- setup check (Phase 0 item 7 harness) ----------

$("setup-run").addEventListener("click", async () => {
  $("setup-out").hidden = false;
  $("setup-out").textContent = "Checking…";
  // Ask every open tab of each site, most recently used first, until one answers. Asking
  // only the first one Chrome lists hit a stale tab (opened before the extension was
  // reloaded, can't answer) while a fresh one sat in another window (2026-10-12).
  async function ask(url, msg) {
    const tabs = (await chrome.tabs.query({ url })).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    let error = null;
    for (const t of tabs) {
      const r = await send(t.id, msg).catch((e) => { error = String(e?.message || e).slice(0, 200); return null; });
      if (r) return { tabs: tabs.length, r };
    }
    return { tabs: tabs.length, r: null, error };
  }
  const rsAsk = await ask(`${RS}*`, { type: "rs:setup" });
  const wfAsk = await ask(`${WF}*`, { type: "webforms:setup" });
  const rs = rsAsk.r, wf = wfAsk.r;
  const rsTab = rsAsk.tabs > 0, wfTab = wfAsk.tabs > 0;
  if (wf && rs?.signedIn && wf.signedIn) {
    wf.samePerson = String(wf.userName || "").trim().toLowerCase() === String(rs.fullName || "").trim().toLowerCase();
  }
  let text = setupReport({ rs, wf });
  if (!rsTab) text += "\n(open Real Signature in a tab to check it)";
  else if (!rs) text += `\n(${rsAsk.tabs === 1 ? "the Real Signature tab" : `none of the ${rsAsk.tabs} Real Signature tabs`} answered — reload ${rsAsk.tabs === 1 ? "it" : "them"} once and run the check again)`
    + (rsAsk.error ? `\n  error: ${rsAsk.error}` : "");
  if (!wfTab) text += "\n(open WEBForms in a tab to check it)";
  else if (!wf) text += `\n(${wfAsk.tabs === 1 ? "the WEBForms tab" : `none of the ${wfAsk.tabs} WEBForms tabs`} answered — reload ${wfAsk.tabs === 1 ? "it" : "them"} once and run the check again)`
    + (wfAsk.error ? `\n  error: ${wfAsk.error}` : "");
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
