// WEBForms side. Terms-driven rules (PLAN.md "Terms review"):
//   - never changes WEBForms' page (no injected buttons, no restyling);
//   - acts only when the agent clicks in OUR side panel;
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
    const [{ WebForms, readBearer, partiesFromFormValues }, pdf] = await Promise.all([lib("webforms-api.js"), lib("pdf.js")]);
    return { wf: new WebForms({ getToken: () => readBearer(localStorage.getItem("ls.lastBearer")) }), pdf, partiesFromFormValues };
  })();
  return clientP;
}

const ADDRESS_VARS = ["txtp_streetnum", "txtp_street", "txtp_city"];

async function details({ transactionId, formIds }) {
  const { wf, partiesFromFormValues } = await client();
  const [{ name: userName, email: userEmail }, transaction] = await Promise.all([
    wf.user(),
    transactionId ? wf.transaction(transactionId) : null,
  ]);
  const forms = [];
  for (const id of formIds) forms.push({ id, ...(await wf.formInfo(id)) }); // one at a time (rule 1)
  // Only the address leaves this script; the rest of the form's typed values stay here.
  const v = forms[0]?.values;
  const firstFormValues = v ? Object.fromEntries(ADDRESS_VARS.map((k) => [k, v[k] ?? ""])) : null;
  return {
    userName,
    userEmail, // compared in the panel only, never shown
    transaction: transaction && {
      Name: transaction.Name, Address: transaction.Address, StreetNumber: transaction.StreetNumber,
      StreetName: transaction.StreetName, City: transaction.City,
    },
    // Buyer and seller COUNTS from the typed-in names, a hint for the signer numbers.
    forms: forms.map(({ id, pageCount, formGuid, values }) => ({ id, pageCount, formGuid, parties: partiesFromFormValues(values) })),
    firstFormValues,
  };
}

// Ticking a form or adding it to the Basket fires no tab event, so an open panel would keep
// showing the old picks. Tell the panel something was clicked; it re-reads the selection
// itself and redraws only if it changed. Passive listeners: nothing on the page is altered
// or blocked, no request is made, and only the word "changed" leaves this script.
// Debounced so Angular has finished updating before the panel looks.
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
    }
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
