// Which forms are picked in a WEBForms tab, read off the page itself. Shared by the popup
// (panel.js) and the service worker, which reads it for "Start as soon as I click the
// Dotted Line icon" with one click off (background.js startFromClick).

// Runs in the PAGE's world (chrome.scripting, world MAIN): the ticks and the Basket live in
// WEBForms' Angular state, which an isolated content script can't see. Read-only, and it
// returns ids and names only.
export function readSelection() {
  const ng = window.angular;
  if (!ng) return { error: "WEBForms is still loading." };
  const pick = (x) => (x && x.ID ? { id: x.ID, name: x.Name, transactionId: x.TransactionID || "", lastModified: x.LastModified || null } : null);
  // Speed (2026-10-14): what the page already holds is read here rather than asked of
  // WEBForms again — who's signed in (the same object GetPopulatedGlobalJson answers, on
  // every page) and, on a deal, the deal itself. Missing → the content script asks as before.
  let user = null;
  try {
    const g = ng.element(document.body).injector().get("globalVariablesSvc").globalJson;
    const email = g?.GtmDataLayer?.TransactionDesk?.Account?.Email;
    if (g && typeof g.UserName === "string") user = { name: g.UserName, email: typeof email === "string" && email.includes("@") ? email : null };
  } catch { /* asked for instead */ }
  const deal = location.pathname.match(/^\/transaction\/detail\/([^/]+)/i);
  if (deal) {
    const out = new Map();
    for (const node of document.querySelectorAll(".dr-item-selector")) {
      if (!node.querySelector("i.isfontpack-ok_circle")) continue;
      const s = ng.element(node).scope();
      const f = pick(s && (s.form || s.instance));
      if (f) out.set(f.id, f);
    }
    let transaction = null;
    try {
      const t = ng.element(document.querySelector('[ng-controller^="transactionDetailCtrl"]')).scope()?.transaction;
      if (t && typeof t.Name === "string") {
        transaction = Object.fromEntries(["Name", "Address", "StreetNumber", "StreetName", "City", "MLSNumber", "UnitNumber"].map((k) => [k, t[k] ?? null]));
      }
    } catch { /* asked for instead */ }
    return { source: "deal", transactionId: deal[1], user, transaction, forms: [...out.values()] };
  }
  if (/^\/forms(\/|$)/i.test(location.pathname)) {
    try {
      const items = ng.element(document.body).injector().get("commonSvc").basket.baskets.forms || [];
      return { source: "basket", transactionId: "", user, forms: items.map(pick).filter(Boolean) };
    } catch {
      return { error: "Couldn't read the Basket — WEBForms may have changed." };
    }
  }
  if (/^\/form\//i.test(location.pathname)) {
    // Phase 2, an open form. The zip gives the form AS LAST SAVED and WEBForms has no
    // auto-save, so unsaved edits would silently be left out. WEBForms' own leave-page
    // prompt decides "unsaved" by comparing the editor's savedFormFieldValues with
    // formFieldValues, plus hasUnsavedFieldSettings() (formEditorCtrl as vm, seen
    // 2026-10-12) — the same test is used here, only READ. Never call vm.ensureSaved():
    // it saves (rule 2). A value in a field the saved copy doesn't list also counts as
    // unsaved — stricter than WEBForms, because a stale copy is the one thing not allowed.
    const node = document.querySelector('[ng-controller^="formEditorCtrl"]');
    const vm = node && ng.element(node).scope()?.vm;
    const o = vm?.formObj;
    if (!o || !o.ID) return { source: "open", forms: [], loading: true };
    // Fail closed (outside review, 2026-10-15): if WEBForms stops exposing either copy, "no
    // differences" would just mean "nothing to compare" — count it as unsaved, so Create
    // stays off and a stale copy can't go out silently.
    const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
    const shapeOk = isObj(vm.savedFormFieldValues) && isObj(vm.formFieldValues);
    const saved = shapeOk ? vm.savedFormFieldValues : {}, cur = shapeOk ? vm.formFieldValues : {};
    // Money fields are saved as "500000.00" but shown as "500,000.00": an untouched form
    // in a transaction read as unsaved on price and deposit (2026-10-14). The same number,
    // give or take commas, a $ and spaces, is the same value.
    const money = /^\s*\$?\s*-?[\d,]*\.?\d+\s*$/;
    const same = (a, b) => a === b
      || (typeof a === "string" && typeof b === "string" && money.test(a) && money.test(b)
        && Number(a.replace(/[$,\s]/g, "")) === Number(b.replace(/[$,\s]/g, "")));
    let unsaved = !shapeOk || Object.keys(saved).some((k) => !same(cur[k], saved[k]))
      || Object.keys(cur).some((k) => !(k in saved) && cur[k] != null && cur[k] !== "");
    // A check that throws can't vouch for the form either: unknown counts as unsaved.
    try { unsaved = unsaved || !!vm.hasUnsavedFieldSettings?.(); } catch { unsaved = true; }
    const name = o.Name || vm.formData?.FormName || "This form";
    // The address as last SAVED, straight from the page. Asking WEBForms' API right after a
    // Save could still answer with the copy from before it (2026-10-12: the first draft
    // after typing an address and saving was titled with the form name alone; the same
    // form a reload later got the address).
    const address = { txtp_unitNumber: saved.txtp_unitNumber ?? "", txtp_streetnum: saved.txtp_streetnum ?? "", txtp_street: saved.txtp_street ?? "", txtp_city: saved.txtp_city ?? "" };
    // Speed (2026-10-14): the editor already holds what GET formfields answers — page count,
    // FormGUID, the saved values — plus the form type. Asking WEBForms again took ~4 s on
    // every icon click. Handed to the WEBForms content script for the same derivations,
    // never stored.
    const fd = vm.formData || {};
    const preloaded = {
      [o.ID]: {
        pageCount: Number.isInteger(fd.PageCount) ? fd.PageCount : null,
        formGuid: typeof fd.FormGUID === "string" ? fd.FormGUID : null,
        library: typeof o.Library === "string" && o.Library.trim() ? o.Library.trim() : null,
        values: saved,
      },
    };
    return { source: "open", transactionId: o.TransactionID || "", unsaved, cantCheck: !shapeOk, address, preloaded, user,
      forms: [{ id: o.ID, name, transactionId: o.TransactionID || "", lastModified: null }] };
  }
  return { source: "other", forms: [] };
}

export async function selection(tabId) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readSelection });
  if (r?.result?.error) throw new Error(r.result.error);
  return r?.result || { source: "other", forms: [] };
}
