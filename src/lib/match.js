// Which Real Signature template goes with which WEBForms form.
// The agent chooses once; we remember it by the form's identity and suggest by name after.
// A remembered choice is still refused if the page count no longer matches — provincial
// associations revise their forms, and a block on the wrong page is worse than no block.

export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\.pdf$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Stable key for a form TYPE: WEBForms' library code ("AREA0287"), else its name.
 *  Not FormGUID — that turned out to be the form's own id (it equals the form's ID), so a
 *  choice keyed on it was remembered for that one form and never the next (2026-10-12). */
export function formKey(form) {
  return form.library ? `lib:${form.library}` : `name:${normalizeName(form.name)}`;
}

/** Which clients sign, when the deal or the agent's side in WEBForms says: "BUYER",
 *  "SELLER", or null (both, or can't tell). The same order signerCounts goes by. */
export function signingSide({ deal = null, agentSide = null } = {}) {
  const one = (s) => (s === "BUYER" || s === "SELLER" ? s : null);
  return one(deal?.side) || one(agentSide);
}

/** Where a choice is remembered: per form type AND per side, because Real Signature ties
 *  every block to a role — a form both sides sign (the Consumer Relationships Guide) needs
 *  a buyer template and a seller one (2026-10-14). Side unknown → the form type alone,
 *  which is also where every choice made before this was kept. */
export function rememberKey(form, side = null) {
  return side ? `${formKey(form)}|${side}` : formKey(form);
}

/** Why a template is no use on this side, or null. Its blocks are only for the side that
 *  isn't signing, so leaving off the absent signers' blocks (dropUnusedSlots) would leave
 *  none — it happened silently on a buyer deal with a seller-only guide template.
 *  template.slots: templateSlots() ({BUYER, SELLER} signer counts). */
export function sideMismatch(template, side) {
  const slots = template?.slots;
  if (!side || !slots) return null;
  const other = side === "BUYER" ? "SELLER" : "BUYER";
  if ((slots[side] || 0) > 0 || !((slots[other] || 0) > 0)) return null;
  return `it has ${other.toLowerCase()} blocks only, and this deal's signers are ${side.toLowerCase()}s`;
}

/** A remembered choice is {id, template, form, at} — the names as they were when picked, for
 *  the Settings list — or, saved before 2026-10-13, the bare template id. */
export function rememberedId(entry) {
  if (!entry) return null;
  return typeof entry === "string" ? entry : typeof entry.id === "string" ? entry.id : null;
}

/** The entry to keep for a choice just made. */
/** A remembered choice that isn't a template: blocks from the form's labels (autoplace.js).
 *  The same value as the panel's option and planDraft's template id. */
export const LABELS = "auto";
export const LABELS_NAME = "Place blocks from the form's labels";

export function rememberEntry(form, template, now = Date.now()) {
  return { id: template.id, template: template.name || "", form: String(form.name || "").replace(/\.pdf$/i, ""), at: now };
}

/** Old entries keyed on FormGUID ("guid:…") were per form, not per type (see formKey), so
 *  nothing will ever look them up again. Dropped whenever the list is saved. */
export function pruneRemembered(remembered) {
  return Object.fromEntries(Object.entries(remembered || {}).filter(([k, v]) => !k.startsWith("guid:") && rememberedId(v)));
}

export function checkPages(form, template) {
  if (typeof form.pageCount !== "number" || typeof template.pagesCount !== "number") {
    return { ok: false, reason: "page count unknown — can't confirm this template fits" };
  }
  if (form.pageCount !== template.pagesCount) {
    return { ok: false, reason: `form has ${form.pageCount} pages, template has ${template.pagesCount}` };
  }
  return { ok: true };
}

function overlap(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

/** Pick a template for a form: the remembered one if it still exists and fits,
 *  otherwise name suggestions (best first) that fit. Never auto-applies a suggestion —
 *  the caller shows it to the agent. side: signingSide(), to look up that side's choice
 *  first and refuse a template with no blocks for it.
 *  refused.kind: "pages" (the form was revised) or "side" (see sideMismatch). */
export function suggestTemplate(form, templates, remembered = {}, side = null) {
  const id = rememberedId(remembered[rememberKey(form, side)] ?? remembered[formKey(form)]);
  // The agent switched a remembered template to "Place blocks from the form's labels"
  // (Dan, 2026-10-29: remembered like a template). labels: that's the choice to pre-select.
  if (id === LABELS) return { remembered: null, labels: true, refused: null, suggestions: [] };
  const chosen = id && templates.find((t) => t.id === id);
  let refused = null;
  if (chosen) {
    const fit = checkPages(form, chosen);
    const wrongSide = fit.ok ? sideMismatch(chosen, side) : null;
    if (fit.ok && !wrongSide) return { remembered: chosen, refused: null, suggestions: [] };
    refused = fit.ok ? { template: chosen, reason: wrongSide, kind: "side" } : { template: chosen, reason: fit.reason, kind: "pages" };
  }
  const name = normalizeName(form.name);
  const suggestions = templates
    .filter((t) => t !== chosen)
    .map((t) => ({ template: t, score: overlap(name, normalizeName(t.name)) }))
    .filter((s) => s.score >= 0.5 && checkPages(form, s.template).ok && !sideMismatch(s.template, side))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.template);
  return { remembered: null, refused, suggestions };
}
