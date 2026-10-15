// WEBForms side. Terms-driven rules (PLAN.md "Terms review"):
//   - never changes WEBForms' page (no injected buttons, no restyling);
//   - acts only on the agent's clicks: in our popup, or ticking forms in a deal's Forms list
//     (which starts their read-only lookups early — see lookAhead);
//   - talks to WEBForms only through src/lib/webforms-api.js, an allowlist of requests
//     WEBForms' own pages make: its zip download and read-only lookups. Nothing saves.
//
// Which forms are picked is read by the panel (a MAIN-world read of the page's own
// selection — an isolated content script can't see Angular's state). This script does the
// network part, same-origin with the page's own sign-in, and hands back raw bytes.

function where() {
  const m = location.pathname.match(/\/form\/([^/]+)/);
  if (m) return { page: "form", formId: m[1] };
  const t = location.pathname.match(/\/transaction\/detail\/([^/]+)/i);
  if (t) return { page: "transaction", transactionId: t[1] };
  if (/^\/forms(\/|$)/i.test(location.pathname)) return { page: "library" };
  return { page: "other" };
}

let clientP;
function client() {
  clientP ??= (async () => {
    const lib = (p) => import(chrome.runtime.getURL(`src/lib/${p}`));
    const api = await lib("webforms-api.js");
    const pdf = await lib("pdf.js");
    return { ...api, wf: new api.WebForms({ getToken: () => api.readBearer(localStorage.getItem("ls.lastBearer")) }), pdf };
  })();
  return clientP;
}

const ADDRESS_VARS = ["txtp_unitNumber", "txtp_streetnum", "txtp_street", "txtp_city"];

// Looked up ahead, on the tick (Dan, 2026-10-14): ticking a form in a deal's Forms list
// starts its lookup (~0.5 s, ~4 s for a big contract), so by the time the agent clicks the
// icon it's done or under way. Kept in this tab's memory only, for AHEAD_MS and only while
// the agent stays on that page; a failed lookup is just asked again on the click. At most
// 4 lookups at once (ticking "all" mustn't fire twenty), the same cap as the click uses.
const AHEAD_MS = 2 * 60e3;
const ahead = new Map(); // formId → {at, path, p: Promise<{pageCount, formGuid, values, library}>}
let running = 0;
const waiting = [];
async function slot(fn) {
  while (running >= 4) await new Promise((go) => waiting.push(go));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}
function lookUp(id) {
  const key = String(id).toLowerCase(); // the markup's and Angular's ids agree today; cheap insurance
  const hit = ahead.get(key);
  if (hit && Date.now() - hit.at < AHEAD_MS && hit.path === location.pathname) return hit.p;
  const p = slot(async () => {
    const { wf } = await client();
    const [info, library] = await Promise.all([wf.formInfo(id), wf.formLibrary(id).catch(() => null)]);
    return { ...info, library };
  });
  ahead.set(key, { at: Date.now(), path: location.pathname, p });
  p.catch(() => ahead.delete(key));
  return p;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The forms ticked in a deal's Forms list, read from the page's markup (each row's buttons
 *  carry the form's id in `is-id`; a tick shows as the ok_circle icon — the same test
 *  panel.js readSelection makes). Read only. */
function tickedIds() {
  if (!/^\/transaction\/detail\//i.test(location.pathname)) return [];
  return [...document.querySelectorAll(".dr-item-selector")]
    .filter((n) => n.querySelector("i.isfontpack-ok_circle"))
    .map((n) => n.closest("[ng-repeat]")?.querySelector("[is-id]")?.getAttribute("is-id"))
    .filter((id) => GUID.test(id || ""));
}
function lookAhead() {
  for (const [id, e] of ahead) if (Date.now() - e.at >= AHEAD_MS || e.path !== location.pathname) ahead.delete(id);
  for (const id of tickedIds()) lookUp(id).catch(() => {});
}

// Read from the page by panel.js readSelection, so WEBForms isn't asked again: user
// {name, email} (every page), transaction (a deal's page), preloaded {formId: {pageCount,
// formGuid, library, values}} (an open form's editor — saves the ~4 s formfields request).
// Forms ticked in a list aren't open, so they're asked for — usually already, on the tick.
async function details({ transactionId, formIds, preloaded = null, user = null, transaction: onPage = null }) {
  const { wf, partiesFromFormValues, buyerNamesFromFormValues, agentSideFromFormValues, agentSideFromContacts, combineSides,
    partiesFromContacts, buyerNamesFromContacts, mergeParties, peopleFromContacts } = await client();
  const [{ name: userName, email: userEmail }, transaction, contacts] = await Promise.all([
    user || wf.user(),
    onPage || (transactionId ? wf.transaction(transactionId) : null),
    // Who's who on the deal: the agent's side, and how many buyers and sellers. A failure
    // just falls back to the forms.
    transactionId ? wf.contacts(transactionId).catch(() => null) : null,
  ]);
  // A few forms at a time, not one by one: WEBForms answers them side by side, so the wait
  // is the slowest form (an 8-page contract, ~4 s) rather than the sum (2026-10-14, 3 forms:
  // 6.1 s in turn, 4.8 s together). Capped at 4 (slot), a smaller burst than opening a form
  // makes — rule 1 is about not overburdening WEBForms (AUP §1). Forms looked up on the
  // tick (lookAhead) come from there, finished or still on the way.
  const forms = await Promise.all(formIds.map(async (id) => {
    const p = preloaded?.[id];
    return p && p.pageCount && p.values ? { id, ...p } : { id, ...(await lookUp(id)) };
  }));
  const names = await typeNames(wf, forms.map((f) => f.library).filter(Boolean));
  // Only the address, the buyers' names and the deal's Buyer and Seller contacts leave this
  // script, and only as far as the hand-off; the rest of the form's typed values stay here.
  // From the first form that HAS one: a basket often starts with the Consumer Relationships
  // Guide, which has no address fields, and the title lost its address (2026-10-13).
  const v = (forms.find((f) => f.values?.txtp_streetnum || f.values?.txtp_street) || forms[0])?.values;
  const firstFormValues = v ? Object.fromEntries(ADDRESS_VARS.map((k) => [k, v[k] ?? ""])) : null;
  return {
    userName,
    userEmail, // compared in the panel only, never shown
    transaction: transaction && {
      Name: transaction.Name, Address: transaction.Address, StreetNumber: transaction.StreetNumber,
      StreetName: transaction.StreetName, City: transaction.City, MLSNumber: transaction.MLSNumber,
      UnitNumber: transaction.UnitNumber,
    },
    // Buyer and seller COUNTS from the typed-in names, a hint for the signer numbers.
    forms: forms.map(({ id, pageCount, formGuid, library, values }) => ({
      id, pageCount, formGuid, library, typeName: (library && names[library]) || null,
      parties: partiesFromFormValues(values),
    })),
    firstFormValues,
    // How many buyers and sellers sign, per side: the transaction's Contacts (WEBForms' own,
    // any province) when they list anyone on that side, else the names typed on the forms
    // (AREA's field names). Counts only.
    parties: mergeParties(partiesFromContacts(contacts), forms.map((f) => partiesFromFormValues(f.values))),
    // The signers when no reZEN deal is picked: the deal's Buyer and Seller contacts, with
    // their emails when WEBForms has them.
    contactPeople: peopleFromContacts(contacts),
    // For matching a reZEN Buyer Record (a new buyer: no deal, no address yet).
    buyerNames: [...new Set([...buyerNamesFromContacts(contacts), ...forms.flatMap((f) => buyerNamesFromFormValues(f.values))])],
    // Which side the signed-in agent is on: the transaction's Contacts first (the deal's own
    // record), else the agent emails on the forms (standalone forms have no Contacts).
    // Decides who signs when there's no reZEN deal to say — a new buyer, say.
    agentSide: agentSideFromContacts(contacts, userEmail)
      || combineSides(forms.map((f) => agentSideFromFormValues(f.values, userEmail))),
  };
}

// Form type names (library code → "Agreement to Represent Both…"). The list they come from
// is the whole Forms library, ~650 KB, so the names are kept in this browser and the list
// is fetched again only for a code not seen before. Type names aren't client data.
async function typeNames(wf, codes) {
  const { libraryNames: cached = {}, libraryNamesAt = 0 } =
    await chrome.storage.local.get(["libraryNames", "libraryNamesAt"]).catch(() => ({}));
  // A code the index doesn't list (a custom form, say) would otherwise refetch the ~650 KB
  // index on every hand-off; once a day is enough to pick up a newly added form type.
  if (codes.every((c) => c in cached) || Date.now() - libraryNamesAt < 24 * 3600e3) return cached;
  try {
    const fresh = { ...cached, ...(await wf.libraryNames()) };
    await chrome.storage.local.set({ libraryNames: fresh, libraryNamesAt: Date.now() }).catch(() => {});
    return fresh;
  } catch {
    return cached; // no type name just means the form's own name is shown
  }
}

// Ticking a form or adding it to the Basket fires no tab event, so an open panel would keep
// showing the old picks. Tell the panel something was clicked; it re-reads the selection
// itself and redraws only if it changed. Passive listeners: nothing on the page is altered
// or blocked, and only the word "changed" leaves this script. The same pause starts the
// lookups for newly ticked forms (lookAhead) — the one request made here.
// Debounced so Angular has finished updating before anything looks.
// When the extension is reloaded or updated, this copy keeps running in already-open tabs
// but is cut off: sendMessage then THROWS "Extension context invalidated" synchronously
// (a .catch never sees it) and Chrome lists it as an extension error on every click
// (2026-10-12). So check first, and an orphaned copy removes its own listeners.
const NUDGE_EVENTS = ["click", "change", "keyup"];
let nudge;
function onPageEvent() {
  clearTimeout(nudge);
  nudge = setTimeout(() => {
    if (!chrome.runtime?.id) { stopNudging(); return; }
    try {
      chrome.runtime.sendMessage({ type: "webforms:changed" }).catch(() => {});
    } catch {
      stopNudging();
      return;
    }
    lookAhead();
  }, 400);
}
function stopNudging() {
  for (const type of NUDGE_EVENTS) document.removeEventListener(type, onPageEvent, { capture: true });
}
for (const type of NUDGE_EVENTS) document.addEventListener(type, onPageEvent, { capture: true, passive: true });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "webforms:where") { reply(where()); return false; }
  const run = {
    "webforms:details": () => details(msg),
    "webforms:zip": async () => {
      const { wf, pdf } = await client();
      return { zipBase64: pdf.toBase64(await wf.downloadZip(msg.forms)) };
    },
    "webforms:setup": async () => {
      const { wf } = await client();
      try { const u = await wf.user(); return { signedIn: true, userName: u.name, userEmail: u.email }; } catch { return { signedIn: false }; }
    },
  }[msg.type];
  if (!run) return false;
  run().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});
