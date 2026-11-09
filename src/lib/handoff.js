// What a hand-off from WEBForms carries, worked out from the page's picks (selection.js)
// and the WEBForms content script's read-only lookups (webforms:details). Pure, so the
// popup (panel.js) and the service worker (background.js startFromClick) make the same
// hand-off from the same forms: the worker does it for "Start as soon as I click the
// Dotted Line icon" with one click off, where no popup is there to do it.

import { suggestTitle, matchAddress } from "./title.js";
import { titleValues, titleFor } from "./pattern.js";

/** Settings → "Start as soon as I click" with one click OFF: the icon click on WEBForms
 *  goes to the service worker (no popup), which opens Real Signature and its side panel
 *  within that click. With one click on, the popup does it as before: one click's own
 *  behaviour is not changed by this (issue #11). */
export const startsFromClick = (s) => !!(s?.startOnOpen && !s?.autoCreate);

/** Why these picks can't be handed over yet, or null when they can. The same tests the
 *  popup makes before its Prepare button goes live: some forms, none still loading, and an
 *  open form saved (an unknown counts as unsaved, as there). */
export function notReady(sel) {
  if (!sel || sel.error) return "unreadable";
  if (!Array.isArray(sel.forms) || !sel.forms.length) return sel?.loading ? "loading" : "none";
  if (sel.unsaved || sel.cantCheck) return "unsaved";
  return null;
}

/** The same forms still picked, and still saved: looked at again just before the download,
 *  as the popup's Prepare click does, so a copy edited meanwhile never goes out. */
export function samePicks(before, now) {
  const ids = (s) => (s?.forms || []).map((f) => f.id).sort().join();
  return !notReady(now) && ids(before) === ids(now);
}

/** The webforms:details message for these picks. */
export function detailsRequest(sel) {
  const transactionId = sel.transactionId
    || (new Set(sel.forms.map((f) => f.transactionId)).size === 1 ? sel.forms[0].transactionId : "");
  return { type: "webforms:details", transactionId, formIds: sel.forms.map((f) => f.id),
    preloaded: sel.preloaded || null, user: sel.user || null, transaction: sel.transaction || null };
}

/** Picks + details + Settings → the forms and the words the hand-off needs, and the title
 *  the Settings would give it. */
export function webformsHandoff({ sel, d, settings }) {
  const info = new Map((d.forms || []).map((f) => [f.id, f]));
  // An open form: the page's saved copy is the freshest (selection.js reads it).
  const firstFormValues = sel.address || d.firstFormValues;
  const forms = sel.forms.map((f) => ({ ...f, ...info.get(f.id) }));
  // From here on a form is titled by its type's name, WEBForms' own name only as a fallback.
  const titled = forms.map((f) => ({ ...f, name: f.typeName || f.name }));
  const values = titleValues({ transaction: d.transaction, forms: titled, firstFormValues, agent: d.userName });
  const suggested = suggestTitle({ transaction: d.transaction, forms: titled, firstFormValues });
  return {
    forms,
    userName: d.userName, userEmail: d.userEmail || null,
    address: matchAddress({ transaction: d.transaction, firstFormValues }),
    buyerNames: d.buyerNames || [],
    agentSide: d.agentSide || null,
    parties: d.parties || null,
    contactPeople: d.contactPeople || [],
    titleValues: values,
    title: titleFor(settings, values, suggested),
  };
}

/** The job:start meta for a hand-off. title: what the agent left in the box (the popup),
 *  or the Settings' title (the worker); blank → the first form's name. */
export function handoffMeta(h, { source, title, formDetails }) {
  return {
    title: String(title || "").trim() || h.forms[0].typeName || h.forms[0].name,
    source, address: h.address, buyerNames: h.buyerNames, agentSide: h.agentSide, parties: h.parties,
    contactPeople: h.contactPeople, titleValues: h.titleValues, webformsUserName: h.userName,
    webformsUserEmail: h.userEmail, timings: { formDetails },
  };
}
